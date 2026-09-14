import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { subscribeToPlatform } from "../subscriptions/platform-service.js";
import { cleanupTestUsers, createTestCreator, type TestCreator } from "../test/fixtures.js";

// createVodFromRecording (unlike this file's siblings, service.test.ts)
// genuinely needs uploadObject to succeed — real object storage isn't
// configured in this test env (VOD_S3_* unset), so it's mocked here, same
// posture as clip-service.test.ts/download-service.test.ts. getSignedVodUrl
// is real elsewhere in the suite (pure local URL-signing, no network call
// — see object-storage.ts's own comment) but mocked here too for a
// predictable assertion surface.
const uploadObjectMock = vi.fn(async (key: string, _body: Buffer, _contentType: string) => key);

vi.mock("../common/object-storage.js", () => ({
  uploadObject: (...args: [string, Buffer, string]) => uploadObjectMock(...args),
  getSignedVodUrl: async (key: string) => `https://signed.example/${key}`,
}));

const { createVodFromRecording } = await import("./service.js");

const createdUserIds: string[] = [];

async function trackedCreator(): Promise<TestCreator> {
  const creator = await createTestCreator();
  createdUserIds.push(creator.id);
  return creator;
}

// Direct cache-balance seed, not a real ledger transaction — same
// technique fixtures.ts's own fundCreatorEarnings uses to fund the
// *source* side of a transfer (line ~174 there): there's no
// counterparty to this money in the test, only subscribeToPlatform's own
// subsequent charge needs a real, balanced ledger entry pair, which it
// creates itself.
async function fundWallet(walletId: string, amountSantim: number): Promise<void> {
  await pool.query(`UPDATE wallet_balances_cache SET balance_santim = $2 WHERE wallet_id = $1`, [
    walletId,
    amountSantim,
  ]);
}

async function retentionDaysFor(vodId: string): Promise<number> {
  const { rows } = await pool.query<{ days: number }>(
    `SELECT EXTRACT(DAY FROM (expires_at - created_at))::int AS days FROM stream_vods WHERE id = $1`,
    [vodId]
  );
  return rows[0]!.days;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(() => {
  uploadObjectMock.mockClear();
  vi.unstubAllGlobals();
});

// Fresh migration defaults (0015/0069): default=7, anchor=30, birqPlus=60
// — distinct enough that a test asserting "the longer window wins" isn't
// relying on the platform_config admin having left every tunable at some
// particular value.
describe("createVodFromRecording retention (Build 3 — Birq Plus)", () => {
  function stubRecordingFetch(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }) as unknown as Response)
    );
  }

  it("uses the platform default for a plain creator", async () => {
    const creator = await trackedCreator();
    stubRecordingFetch();

    const vod = await createVodFromRecording(creator.streamId, "https://recordings.example/a.mp4");

    expect(await retentionDaysFor(vod.id)).toBe(7);
  });

  it("uses the Anchor window for an Anchor creator with no subscription", async () => {
    const creator = await trackedCreator();
    await pool.query(`UPDATE creator_profiles SET is_anchor_creator = TRUE WHERE user_id = $1`, [creator.id]);
    stubRecordingFetch();

    const vod = await createVodFromRecording(creator.streamId, "https://recordings.example/b.mp4");

    expect(await retentionDaysFor(vod.id)).toBe(30);
  });

  it("uses the Birq Plus window for a subscriber who isn't an Anchor creator", async () => {
    const creator = await trackedCreator();
    await fundWallet(creator.walletId, 15_000);
    await subscribeToPlatform(creator.id, 15_000);
    stubRecordingFetch();

    const vod = await createVodFromRecording(creator.streamId, "https://recordings.example/c.mp4");

    expect(await retentionDaysFor(vod.id)).toBe(60);
  });

  it("takes the longer of the two windows either way, not a fixed Birq Plus override", async () => {
    const creator = await trackedCreator();
    await pool.query(`UPDATE creator_profiles SET is_anchor_creator = TRUE WHERE user_id = $1`, [creator.id]);
    await fundWallet(creator.walletId, 15_000);
    await subscribeToPlatform(creator.id, 15_000);
    // Temporarily push Anchor's own window above Birq Plus's default (60)
    // — if createVodFromRecording took Math.max, this creator still gets
    // 90; a bug that special-cased "Birq Plus always wins" would silently
    // downgrade them to 60 instead. Restored in `finally` since
    // platform_config is a real, shared singleton row other test files
    // also read.
    await pool.query(`UPDATE platform_config SET vod_retention_days_anchor = 90 WHERE id = TRUE`);
    stubRecordingFetch();

    try {
      const vod = await createVodFromRecording(creator.streamId, "https://recordings.example/d.mp4");
      expect(await retentionDaysFor(vod.id)).toBe(90);
    } finally {
      await pool.query(`UPDATE platform_config SET vod_retention_days_anchor = 30 WHERE id = TRUE`);
    }
  });
});
