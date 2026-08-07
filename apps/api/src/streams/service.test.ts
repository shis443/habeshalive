import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { resolveStreamKey } from "../common/crypto.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestUser } from "../test/fixtures.js";
import { getStreamKey, markEndedByProviderStreamId, markLiveByProviderStreamId, reapStaleStreams, rotateStreamKey } from "./service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface CreateStreamOptions {
  playbackUrl?: string | null;
  startedAt?: Date;
}

async function createLiveStream(creatorId: string, options: CreateStreamOptions = {}): Promise<string> {
  const startedAt = options.startedAt ?? new Date();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, playback_url, status, started_at)
     VALUES ($1, 'Test Stream', $2, 'live', $3)
     RETURNING id`,
    [creatorId, options.playbackUrl ?? "https://video.example.com/stream.m3u8", startedAt]
  );
  return rows[0]!.id;
}

async function getStreamStatus(streamId: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM streams WHERE id = $1`, [
    streamId,
  ]);
  return rows[0]!.status;
}

describe("reapStaleStreams", () => {
  it("ends a live stream whose playback URL is unreachable", async () => {
    const creator = await trackUser(await createTestViewer());
    const streamId = await createLiveStream(creator.id, {
      playbackUrl: "https://dead.example.com/gone.m3u8",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );

    await reapStaleStreams();

    expect(await getStreamStatus(streamId)).toBe("ended");
  });

  it("leaves a live stream alone when its playback URL responds 2xx", async () => {
    const creator = await trackUser(await createTestViewer());
    const streamId = await createLiveStream(creator.id, {
      playbackUrl: "https://alive.example.com/ok.m3u8",
    });

    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await reapStaleStreams();

    expect(await getStreamStatus(streamId)).toBe("live");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://alive.example.com/ok.m3u8",
      expect.objectContaining({ method: "HEAD" })
    );
  });

  it("force-ends a stream older than 12h regardless of playback reachability", async () => {
    const creator = await trackUser(await createTestViewer());
    const startedAt = new Date(Date.now() - 13 * 60 * 60 * 1000); // 13h ago
    const streamId = await createLiveStream(creator.id, {
      playbackUrl: "https://alive.example.com/still-ok.m3u8",
      startedAt,
    });

    // Even though the HEAD check would say "reachable", the max-duration
    // backstop should still end it.
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await reapStaleStreams();

    expect(await getStreamStatus(streamId)).toBe("ended");
  });

  it("does not blow up other streams when one stream's check throws", async () => {
    const creator = await trackUser(await createTestViewer());
    const okStreamId = await createLiveStream(creator.id, {
      playbackUrl: "https://alive.example.com/fine.m3u8",
    });
    const explodingStreamId = await createLiveStream(creator.id, {
      playbackUrl: "not a valid url at all",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "not a valid url at all") throw new TypeError("Invalid URL");
        return new Response(null, { status: 200 });
      })
    );

    await expect(reapStaleStreams()).resolves.toBeUndefined();

    expect(await getStreamStatus(okStreamId)).toBe("live");
    // The exploding one is treated as unreachable (its own check failed) and
    // gets ended — but critically, the sweep as a whole didn't throw.
    expect(await getStreamStatus(explodingStreamId)).toBe("ended");
  });
});

async function getRawStreamKeyColumn(userId: string): Promise<string> {
  const { rows } = await pool.query<{ stream_key: string }>(
    `SELECT stream_key FROM creator_profiles WHERE user_id = $1`,
    [userId]
  );
  return rows[0]!.stream_key;
}

describe("stream key encryption at rest + rotation", () => {
  it("stores an encrypted value in the DB, not the plaintext key shown to the creator", async () => {
    const creator = await trackUser(await createTestCreator());

    const raw = await getRawStreamKeyColumn(creator.id);
    // A real generated key is exactly 32 lowercase hex chars (video-
    // provider.ts) — the stored value must NOT be that shape, or
    // encryption silently isn't happening.
    expect(raw).not.toMatch(/^[0-9a-f]{32}$/);

    const { streamKey } = await getStreamKey(creator.id);
    // getStreamKey's response is "{userId}?key={secret}" — the real
    // secret is decryptable from the raw column and must match what the
    // creator is shown.
    const shownSecret = streamKey.split("?key=")[1];
    expect(resolveStreamKey(raw)).toBe(shownSecret);
  });

  it("rotation re-encrypts a fresh key and invalidates the old one for publish auth", async () => {
    const creator = await trackUser(await createTestCreator());
    const before = await getStreamKey(creator.id);
    const oldSecret = before.streamKey.split("?key=")[1]!;

    const rotated = await rotateStreamKey(creator.id);
    const newSecret = rotated.streamKey.split("?key=")[1]!;
    expect(newSecret).not.toBe(oldSecret);

    const rawAfter = await getRawStreamKeyColumn(creator.id);
    expect(resolveStreamKey(rawAfter)).toBe(newSecret);

    // The old key must no longer authenticate a publish...
    await expect(markLiveByProviderStreamId(creator.id, oldSecret)).rejects.toMatchObject({
      statusCode: 401,
    });
    // ...but the new one must.
    await expect(markLiveByProviderStreamId(creator.id, newSecret)).resolves.toBeUndefined();
  });

  it("markLiveByProviderStreamId / markEndedByProviderStreamId authenticate correctly against an encrypted-at-rest key", async () => {
    const creator = await trackUser(await createTestCreator());
    const { streamKey } = await getStreamKey(creator.id);
    const secret = streamKey.split("?key=")[1]!;

    await expect(markLiveByProviderStreamId(creator.id, "definitely-wrong")).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(markLiveByProviderStreamId(creator.id, secret)).resolves.toBeUndefined();
    expect(await getStreamStatus(creator.streamId)).toBe("live");

    await expect(markEndedByProviderStreamId(creator.id, "definitely-wrong")).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(markEndedByProviderStreamId(creator.id, secret)).resolves.toBeUndefined();
    expect(await getStreamStatus(creator.streamId)).toBe("ended");
  });

  it("dual-compat: a legacy plaintext row (pre-encryption) still authenticates correctly", async () => {
    const creator = await trackUser(await createTestCreator());
    // Simulate a row that predates this pass — written as raw plaintext,
    // bypassing rotateStreamKey/ensureCreatorProfile's encryption.
    const legacyPlaintext = "abcdef0123456789abcdef0123456789".slice(0, 32);
    await pool.query(`UPDATE creator_profiles SET stream_key = $1 WHERE user_id = $2`, [
      legacyPlaintext,
      creator.id,
    ]);

    const { streamKey } = await getStreamKey(creator.id);
    expect(streamKey.split("?key=")[1]).toBe(legacyPlaintext);

    await expect(markLiveByProviderStreamId(creator.id, legacyPlaintext)).resolves.toBeUndefined();
  });
});
