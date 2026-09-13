import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestCreator, type TestCreator } from "../test/fixtures.js";
import { rollupStaleViewerSamples, sampleLiveViewerCounts } from "./viewer-samples-service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestCreator>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

// A fresh Response per call, not a single shared instance — this job
// runs against every live stream server-wide, so any test here can see
// fetch invoked more than once (once per live stream left over from an
// earlier test in this same file, none of which end their streams). A
// Response's body can only be read once; reusing one instance across
// multiple invocations throws "Body has already been read" the second
// time .json() runs on it.
function mockPresenceStats(numUsers: number) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ result: { num_clients: numUsers, num_users: numUsers } }), { status: 200 })
  );
}

async function getSamples(streamId: string): Promise<Array<{ viewer_count: number; sampled_at: string }>> {
  const { rows } = await pool.query<{ viewer_count: number; sampled_at: string }>(
    `SELECT viewer_count, sampled_at FROM stream_viewer_samples WHERE stream_id = $1 ORDER BY sampled_at`,
    [streamId]
  );
  return rows;
}

async function getPeakViewers(streamId: string): Promise<number> {
  const { rows } = await pool.query<{ peak_viewers: number }>(`SELECT peak_viewers FROM streams WHERE id = $1`, [
    streamId,
  ]);
  return rows[0]!.peak_viewers;
}

async function insertSample(streamId: string, sampledAt: Date, viewerCount: number): Promise<void> {
  await pool.query(
    `INSERT INTO stream_viewer_samples (stream_id, sampled_at, viewer_count) VALUES ($1, $2, $3)`,
    [streamId, sampledAt, viewerCount]
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.query(`DELETE FROM stream_watch_time_daily`);
  await pool.end();
});

describe("sampleLiveViewerCounts", () => {
  it("writes a sample row and raises peak_viewers for every live stream", async () => {
    const creator = await trackUser(await createTestCreator());
    vi.stubGlobal("fetch", mockPresenceStats(7));

    await sampleLiveViewerCounts();

    const samples = await getSamples(creator.streamId);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.viewer_count).toBe(7);
    expect(await getPeakViewers(creator.streamId)).toBe(7);
  });

  it("never lowers peak_viewers — GREATEST, not overwrite", async () => {
    const creator = await trackUser(await createTestCreator());
    vi.stubGlobal("fetch", mockPresenceStats(50));
    await sampleLiveViewerCounts();
    expect(await getPeakViewers(creator.streamId)).toBe(50);

    vi.stubGlobal("fetch", mockPresenceStats(3));
    await sampleLiveViewerCounts();
    expect(await getPeakViewers(creator.streamId)).toBe(50);
  });

  it("skips a stream (no sample row, no crash) when Centrifugo is unreachable, rather than recording a fabricated 0", async () => {
    const creator = await trackUser(await createTestCreator());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(sampleLiveViewerCounts()).resolves.toBeUndefined();

    expect(await getSamples(creator.streamId)).toHaveLength(0);
    expect(await getPeakViewers(creator.streamId)).toBe(0);
  });

  it("does not sample a stream that isn't live", async () => {
    const creator = await trackUser(await createTestCreator());
    await pool.query(`UPDATE streams SET status = 'ended' WHERE id = $1`, [creator.streamId]);
    const fetchMock = mockPresenceStats(99);
    vi.stubGlobal("fetch", fetchMock);

    await sampleLiveViewerCounts();

    // Other live streams left over from earlier tests in this file are a
    // real, expected side effect of this job's global-by-design scope —
    // asserting "fetch was never called at all" would be asserting
    // something false about a correctly-working system. What actually
    // matters: this specific, now-ended stream's channel was never
    // queried, and it got no sample row.
    const queriedChannels = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).params.channel);
    expect(queriedChannels).not.toContain(`stream-chat:${creator.streamId}`);
    expect(await getSamples(creator.streamId)).toHaveLength(0);
  });
});

describe("rollupStaleViewerSamples", () => {
  it("aggregates samples older than 90 days into stream_watch_time_daily and deletes the raw rows, grouped by Africa/Addis_Ababa day", async () => {
    const creator = await trackUser(await createTestCreator());
    const staleBase = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago, well past the 90-day line
    // staleBase is normalized to 12:00 UTC = 15:00 Addis, comfortably
    // mid-day so +/- a few hours below never crosses a day boundary by
    // accident.
    staleBase.setUTCHours(12, 0, 0, 0);

    // Three samples on the same Addis calendar day.
    await insertSample(creator.streamId, staleBase, 10);
    await insertSample(creator.streamId, new Date(staleBase.getTime() + 60_000), 20);
    await insertSample(creator.streamId, new Date(staleBase.getTime() + 120_000), 30);
    // One sample on the previous Addis calendar day (12 hours earlier
    // crosses midnight Addis time, since staleBase is at 15:00 Addis).
    const previousAddisDay = new Date(staleBase.getTime() - 16 * 60 * 60 * 1000);
    await insertSample(creator.streamId, previousAddisDay, 5);
    // One recent sample (not stale) — must survive untouched.
    await insertSample(creator.streamId, new Date(), 999);

    const groupsRolledUp = await rollupStaleViewerSamples();
    expect(groupsRolledUp).toBe(2); // the two distinct stale Addis-days

    const { rows: daily } = await pool.query<{
      day: string;
      sample_count: number;
      viewer_seconds: string;
      peak_viewer_count: number;
    }>(
      `SELECT day::text, sample_count, viewer_seconds::text, peak_viewer_count
       FROM stream_watch_time_daily WHERE stream_id = $1 ORDER BY day`,
      [creator.streamId]
    );
    expect(daily).toHaveLength(2);

    const previousDayRow = daily[0]!;
    expect(previousDayRow.sample_count).toBe(1);
    expect(Number(previousDayRow.viewer_seconds)).toBe(5 * 60);
    expect(previousDayRow.peak_viewer_count).toBe(5);

    const mainDayRow = daily[1]!;
    expect(mainDayRow.sample_count).toBe(3);
    expect(Number(mainDayRow.viewer_seconds)).toBe((10 + 20 + 30) * 60);
    expect(mainDayRow.peak_viewer_count).toBe(30);

    // Raw stale rows are gone; the recent one survives untouched.
    const remaining = await getSamples(creator.streamId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.viewer_count).toBe(999);
  });

  it("is idempotent — running twice does not double-count", async () => {
    const creator = await trackUser(await createTestCreator());
    const staleAt = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);
    await insertSample(creator.streamId, staleAt, 42);

    const first = await rollupStaleViewerSamples();
    expect(first).toBe(1);
    const second = await rollupStaleViewerSamples();
    expect(second).toBe(0); // no stale raw rows left to roll up

    const { rows } = await pool.query<{ sample_count: number; viewer_seconds: string }>(
      `SELECT sample_count, viewer_seconds::text FROM stream_watch_time_daily WHERE stream_id = $1`,
      [creator.streamId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sample_count).toBe(1);
    expect(Number(rows[0]!.viewer_seconds)).toBe(42 * 60);
  });

  it("leaves samples inside the 90-day window alone", async () => {
    const creator = await trackUser(await createTestCreator());
    const almostStale = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000);
    await insertSample(creator.streamId, almostStale, 15);

    const rolledUp = await rollupStaleViewerSamples();

    expect(rolledUp).toBe(0);
    expect(await getSamples(creator.streamId)).toHaveLength(1);
    const { rows } = await pool.query(`SELECT 1 FROM stream_watch_time_daily WHERE stream_id = $1`, [
      creator.streamId,
    ]);
    expect(rows).toHaveLength(0);
  });
});
