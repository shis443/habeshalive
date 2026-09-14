import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { resolveStreamKey } from "../common/crypto.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestUser } from "../test/fixtures.js";
import { blockCreator } from "../blocks/service.js";
import {
  dismissCreator,
  endStream,
  getLiveStreamByUsername,
  getStreamById,
  getStreamKey,
  listLiveStreams,
  markEndedByProviderStreamId,
  markLiveByProviderStreamId,
  promoteStartingStreams,
  reapStaleStreams,
  rotateStreamKey,
} from "./service.js";

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
  isPpv?: boolean;
  ppvPriceSantim?: number;
}

async function createLiveStream(creatorId: string, options: CreateStreamOptions = {}): Promise<string> {
  const startedAt = options.startedAt ?? new Date();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, playback_url, status, started_at, is_ppv, ppv_price_santim)
     VALUES ($1, 'Test Stream', $2, 'live', $3, $4, $5)
     RETURNING id`,
    [
      creatorId,
      options.playbackUrl ?? "https://video.example.com/stream.m3u8",
      startedAt,
      options.isPpv ?? false,
      options.ppvPriceSantim ?? null,
    ]
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
    // 'starting', not 'live': SRS's on_publish firing means the RTMP
    // handshake completed, not that HLS has packaged anything playable yet
    // — see markLiveByProviderStreamId's own comment and
    // promoteStartingStreams below, which is what actually confirms real
    // output before anything reads 'live'. This assertion used to say
    // "live" and was never updated when that behavior changed; it was
    // failing against a real database, not against this fix.
    expect(await getStreamStatus(creator.streamId)).toBe("starting");

    // promoteStartingStreams is the only path that flips 'starting' to
    // 'live', and only once isManifestReady confirms a real segment exists
    // — stub fetch to return exactly that shape (an #EXTINF-bearing media
    // playlist), matching isManifestReady's own documented contract.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("#EXTM3U\n#EXTINF:4.0,\nseg-0.ts\n", { status: 200 }))
    );
    await promoteStartingStreams();
    expect(await getStreamStatus(creator.streamId)).toBe("live");

    await expect(markEndedByProviderStreamId(creator.id, "definitely-wrong")).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(markEndedByProviderStreamId(creator.id, secret)).resolves.toBeUndefined();
    expect(await getStreamStatus(creator.streamId)).toBe("ended");
  });

  it("does not revive a deliberately-ended stream on a late/retried publish (real bug: End Stream going live again)", async () => {
    const creator = await trackUser(await createTestCreator());
    const { streamKey } = await getStreamKey(creator.id);
    const secret = streamKey.split("?key=")[1]!;

    // createTestCreator's own fixture row has no provider_stream_id set —
    // clear it out of the way so the real INSERT path below (the one that
    // actually stamps provider_stream_id, see markLiveByProviderStreamId's
    // own comment) runs, matching what a real first-ever publish does.
    await pool.query(`UPDATE streams SET status = 'ended' WHERE id = $1`, [creator.streamId]);

    await markLiveByProviderStreamId(creator.id, secret);
    const firstStreamId = (await pool.query<{ id: string }>(
      `SELECT id FROM streams WHERE provider_stream_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [creator.id]
    )).rows[0]!.id;

    // The creator deliberately ends — sets ended_reason = 'creator_ended',
    // unlike a real on_unpublish (markEndedByProviderStreamId), which
    // leaves it NULL. endStream() also auto-rotates the stream key, so the
    // retry below re-fetches it — this test is proving the ended_reason
    // guard itself, independent of the separate old-key-vs-new-key race
    // that also happens in production.
    await endStream(creator.id);
    expect(await getStreamStatus(firstStreamId)).toBe("ended");

    const { streamKey: rotatedKey } = await getStreamKey(creator.id);
    const rotatedSecret = rotatedKey.split("?key=")[1]!;

    // A late/retried RTMP publish handshake lands seconds later — same
    // provider_stream_id, well within the 2-minute grace window.
    await markLiveByProviderStreamId(creator.id, rotatedSecret);

    // The deliberately-ended row must stay ended, not get revived...
    expect(await getStreamStatus(firstStreamId)).toBe("ended");
    // ...and the new publish must start a genuinely new stream instead.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM streams WHERE provider_stream_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [creator.id]
    );
    expect(rows[0]!.id).not.toBe(firstStreamId);
    expect(await getStreamStatus(rows[0]!.id)).toBe("starting");
  });

  it("still revives on a real reconnect (network blip), same as before this fix", async () => {
    const creator = await trackUser(await createTestCreator());
    const { streamKey } = await getStreamKey(creator.id);
    const secret = streamKey.split("?key=")[1]!;

    await pool.query(`UPDATE streams SET status = 'ended' WHERE id = $1`, [creator.streamId]);

    await markLiveByProviderStreamId(creator.id, secret);
    const firstStreamId = (await pool.query<{ id: string }>(
      `SELECT id FROM streams WHERE provider_stream_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [creator.id]
    )).rows[0]!.id;

    // A real on_unpublish from the media server — ended_reason stays NULL.
    await markEndedByProviderStreamId(creator.id, secret);
    expect(await getStreamStatus(firstStreamId)).toBe("ended");

    // Reconnects within the grace window.
    await markLiveByProviderStreamId(creator.id, secret);

    expect(await getStreamStatus(firstStreamId)).toBe("starting");
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM streams WHERE provider_stream_id = $1`,
      [creator.id]
    );
    expect(rows).toHaveLength(1);
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

describe("PPV access gating (toStreamDetail/resolvePpvAccess)", () => {
  it("a non-PPV stream's playbackUrl is visible to anyone, including anonymous viewers", async () => {
    const creator = await trackUser(await createTestViewer());
    await createLiveStream(creator.id);

    const stream = await getLiveStreamByUsername(creator.username);
    expect(stream.isPpv).toBe(false);
    expect(stream.hasPpvAccess).toBe(true);
    expect(stream.playbackUrl).not.toBeNull();
  });

  it("a PPV stream's playbackUrl is null for an anonymous viewer", async () => {
    const creator = await trackUser(await createTestViewer());
    await createLiveStream(creator.id, { isPpv: true, ppvPriceSantim: 5000 });

    const stream = await getLiveStreamByUsername(creator.username);
    expect(stream.isPpv).toBe(true);
    expect(stream.ppvPriceSantim).toBe(5000);
    expect(stream.hasPpvAccess).toBe(false);
    expect(stream.playbackUrl).toBeNull();
  });

  it("a PPV stream's playbackUrl is null for a logged-in viewer with no purchase", async () => {
    const creator = await trackUser(await createTestViewer());
    const viewer = await trackUser(await createTestViewer());
    await createLiveStream(creator.id, { isPpv: true, ppvPriceSantim: 5000 });

    const stream = await getLiveStreamByUsername(creator.username, viewer.id);
    expect(stream.hasPpvAccess).toBe(false);
    expect(stream.playbackUrl).toBeNull();
  });

  it("the creator always sees their own PPV stream's playbackUrl", async () => {
    const creator = await trackUser(await createTestViewer());
    await createLiveStream(creator.id, { isPpv: true, ppvPriceSantim: 5000 });

    const stream = await getLiveStreamByUsername(creator.username, creator.id);
    expect(stream.hasPpvAccess).toBe(true);
    expect(stream.playbackUrl).not.toBeNull();
  });

  it("a viewer with a completed ppv_purchases row sees the playbackUrl", async () => {
    const creator = await trackUser(await createTestViewer());
    const viewer = await trackUser(await createTestViewer());
    const streamId = await createLiveStream(creator.id, { isPpv: true, ppvPriceSantim: 5000 });

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, stream_id, status, completed_at) VALUES ('ppv_purchase', $1, 'completed', now()) RETURNING id`,
      [streamId]
    );
    await pool.query(
      `INSERT INTO ppv_purchases (ledger_transaction_id, stream_id, buyer_id, amount_santim, access_token_jti)
       VALUES ($1, $2, $3, 5000, uuid_generate_v4())`,
      [rows[0]!.id, streamId, viewer.id]
    );

    const stream = await getLiveStreamByUsername(creator.username, viewer.id);
    expect(stream.hasPpvAccess).toBe(true);
    expect(stream.playbackUrl).not.toBeNull();

    // getStreamById threads the same check.
    const byId = await getStreamById(streamId, viewer.id);
    expect(byId.hasPpvAccess).toBe(true);
  });
});

describe("listLiveStreams — isFollowing, blocks, and dismissals", () => {
  it("reports isFollowing true only for an actual follower, false for everyone else", async () => {
    const creator = await trackUser(await createTestCreator());
    const follower = await trackUser(await createTestViewer());
    const stranger = await trackUser(await createTestViewer());
    await createLiveStream(creator.id);
    await pool.query(`INSERT INTO follows (follower_id, creator_id) VALUES ($1, $2)`, [
      follower.id,
      creator.id,
    ]);

    const forFollower = await listLiveStreams({ viewerId: follower.id });
    const forStranger = await listLiveStreams({ viewerId: stranger.id });
    const forAnonymous = await listLiveStreams({});

    expect(forFollower.find((s) => s.creator.id === creator.id)?.creator.isFollowing).toBe(true);
    expect(forStranger.find((s) => s.creator.id === creator.id)?.creator.isFollowing).toBe(false);
    expect(forAnonymous.find((s) => s.creator.id === creator.id)?.creator.isFollowing).toBe(false);
  });

  it("excludes a blocked creator's live stream only for the blocker", async () => {
    const creator = await trackUser(await createTestCreator());
    const blocker = await trackUser(await createTestViewer());
    const stranger = await trackUser(await createTestViewer());
    await createLiveStream(creator.id);
    await blockCreator(blocker.id, creator.id);

    const forBlocker = await listLiveStreams({ viewerId: blocker.id });
    const forStranger = await listLiveStreams({ viewerId: stranger.id });

    expect(forBlocker.some((s) => s.creator.id === creator.id)).toBe(false);
    expect(forStranger.some((s) => s.creator.id === creator.id)).toBe(true);
  });

  it("blocking a creator also removes an existing follow", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());
    await pool.query(`INSERT INTO follows (follower_id, creator_id) VALUES ($1, $2)`, [
      viewer.id,
      creator.id,
    ]);

    await blockCreator(viewer.id, creator.id);

    const { rows } = await pool.query(`SELECT 1 FROM follows WHERE follower_id = $1 AND creator_id = $2`, [
      viewer.id,
      creator.id,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("excludes a dismissed creator's live stream only for the dismissing viewer", async () => {
    const creator = await trackUser(await createTestCreator());
    const dismisser = await trackUser(await createTestViewer());
    const stranger = await trackUser(await createTestViewer());
    await createLiveStream(creator.id);
    await dismissCreator(dismisser.id, creator.id);

    const forDismisser = await listLiveStreams({ viewerId: dismisser.id });
    const forStranger = await listLiveStreams({ viewerId: stranger.id });

    expect(forDismisser.some((s) => s.creator.id === creator.id)).toBe(false);
    expect(forStranger.some((s) => s.creator.id === creator.id)).toBe(true);
  });

  it("dismissing a creator does not touch the follow relationship", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());
    await pool.query(`INSERT INTO follows (follower_id, creator_id) VALUES ($1, $2)`, [
      viewer.id,
      creator.id,
    ]);

    await dismissCreator(viewer.id, creator.id);

    const { rows } = await pool.query(`SELECT 1 FROM follows WHERE follower_id = $1 AND creator_id = $2`, [
      viewer.id,
      creator.id,
    ]);
    expect(rows).toHaveLength(1);
  });
});
