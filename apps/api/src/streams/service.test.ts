import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestViewer, type TestUser } from "../test/fixtures.js";
import { reapStaleStreams } from "./service.js";

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
