import type {
  CreateStreamInput,
  CreatorStats,
  StreamActivity,
  StreamDetail,
  StreamKeyResponse,
} from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { flagIfMatched } from "../moderation/service.js";
import { videoProvider } from "./video-provider.js";

interface CreatorProfileRow {
  user_id: string;
  stream_key: string;
}

interface StreamRow {
  id: string;
  title: string;
  category: string | null;
  language: string | null;
  thumbnail_url: string | null;
  playback_url: string | null;
  started_at: string | null;
  status: string;
  creator_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  peak_viewers: number;
}

function toStreamDetail(row: StreamRow): StreamDetail {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    language: row.language,
    thumbnailUrl: row.thumbnail_url,
    playbackUrl: row.playback_url,
    startedAt: row.started_at,
    status: row.status as StreamDetail["status"],
    viewerCount: row.peak_viewers,
    creator: {
      id: row.creator_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
    },
  };
}

const STREAM_SELECT_COLUMNS = `
  s.id, s.title, s.category, s.language, s.thumbnail_url, s.playback_url,
  s.started_at, s.status, s.peak_viewers,
  u.id AS creator_id, u.username, u.display_name, u.avatar_url, u.bio
`;

async function ensureCreatorProfile(userId: string): Promise<CreatorProfileRow> {
  const existing = await pool.query<CreatorProfileRow>(
    `SELECT user_id, stream_key FROM creator_profiles WHERE user_id = $1`,
    [userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const { streamKey } = await videoProvider.createLiveInput();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<CreatorProfileRow>(
      `INSERT INTO creator_profiles (user_id, stream_key) VALUES ($1, $2)
       RETURNING user_id, stream_key`,
      [userId, streamKey]
    );
    await client.query(`UPDATE users SET role = 'creator' WHERE id = $1 AND role = 'viewer'`, [
      userId,
    ]);
    await client.query("COMMIT");
    return inserted.rows[0]!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getStreamKey(userId: string): Promise<StreamKeyResponse> {
  const profile = await ensureCreatorProfile(userId);
  return { rtmpUrl: videoProvider.getRtmpUrl(), streamKey: profile.stream_key };
}

export async function rotateStreamKey(userId: string): Promise<StreamKeyResponse> {
  await ensureCreatorProfile(userId);
  const { streamKey } = await videoProvider.createLiveInput();
  await pool.query(`UPDATE creator_profiles SET stream_key = $1, updated_at = now() WHERE user_id = $2`, [
    streamKey,
    userId,
  ]);
  return { rtmpUrl: videoProvider.getRtmpUrl(), streamKey };
}

export async function listLiveStreams(): Promise<StreamDetail[]> {
  const { rows } = await pool.query<StreamRow>(
    `SELECT ${STREAM_SELECT_COLUMNS}
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE s.status = 'live'
     ORDER BY s.peak_viewers DESC NULLS LAST, s.started_at DESC`
  );
  return rows.map(toStreamDetail);
}

export async function getStreamById(streamId: string): Promise<StreamDetail> {
  const { rows } = await pool.query<StreamRow>(
    `SELECT ${STREAM_SELECT_COLUMNS}
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE s.id = $1`,
    [streamId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "Stream not found");
  return toStreamDetail(row);
}

export async function getLiveStreamByUsername(username: string): Promise<StreamDetail> {
  const { rows } = await pool.query<StreamRow>(
    `SELECT ${STREAM_SELECT_COLUMNS}
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE u.username = $1 AND s.status = 'live'
     ORDER BY s.started_at DESC LIMIT 1`,
    [username]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "This creator is not live right now");
  return toStreamDetail(row);
}

export async function getStreamActivity(streamId: string): Promise<StreamActivity> {
  const streamResult = await pool.query<{ creator_id: string; started_at: string | null }>(
    `SELECT creator_id, started_at FROM streams WHERE id = $1`,
    [streamId]
  );
  const stream = streamResult.rows[0];
  if (!stream) throw new AppError(404, "Stream not found");

  const giftsResult = await pool.query<{ count: number }>(
    `SELECT count(*) FROM gifts_sent WHERE stream_id = $1`,
    [streamId]
  );

  const subsResult = await pool.query<{ count: number }>(
    `SELECT count(*) FROM subscriptions WHERE creator_id = $1 AND status = 'active'`,
    [stream.creator_id]
  );

  const eventsResult = await pool.query<{
    id: string;
    type: "gift" | "subscription";
    username: string;
    label: string;
  }>(
    `(SELECT gs.id, 'gift' AS type, u.display_name AS username, gt.name || ' x' || gs.quantity AS label, gs.created_at
      FROM gifts_sent gs
      JOIN users u ON u.id = gs.sender_id
      JOIN gift_types gt ON gt.id = gs.gift_type_id
      WHERE gs.stream_id = $1)
     UNION ALL
     (SELECT sub.id, 'subscription' AS type, u.display_name AS username, st.name AS label, sub.created_at
      FROM subscriptions sub
      JOIN users u ON u.id = sub.subscriber_id
      JOIN subscription_tiers st ON st.id = sub.tier_id
      WHERE sub.creator_id = $2 AND sub.created_at >= COALESCE($3, sub.created_at))
     ORDER BY created_at DESC
     LIMIT 5`,
    [streamId, stream.creator_id, stream.started_at]
  );

  return {
    giftsCount: giftsResult.rows[0]?.count ?? 0,
    activeSubscribers: subsResult.rows[0]?.count ?? 0,
    recentEvents: eventsResult.rows.map((row) => ({
      id: row.id,
      type: row.type,
      username: row.username,
      label: row.label,
    })),
  };
}

export async function getCreatorStats(userId: string): Promise<CreatorStats> {
  const followerResult = await pool.query<{ count: number }>(
    `SELECT count(*) FROM follows WHERE creator_id = $1`,
    [userId]
  );
  const hoursResult = await pool.query<{ hours: number | null }>(
    `SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))) / 3600 AS hours
     FROM streams WHERE creator_id = $1 AND started_at IS NOT NULL`,
    [userId]
  );
  return {
    followerCount: followerResult.rows[0]?.count ?? 0,
    streamHoursTotal: Math.round((hoursResult.rows[0]?.hours ?? 0) * 10) / 10,
  };
}

export async function goLive(userId: string, input: CreateStreamInput): Promise<StreamDetail> {
  const profile = await ensureCreatorProfile(userId);

  await pool.query(
    `UPDATE streams SET status = 'ended', ended_at = now()
     WHERE creator_id = $1 AND status IN ('offline', 'live')`,
    [userId]
  );

  const playbackUrl = videoProvider.getPlaybackUrl(profile.stream_key);

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, category, language, playback_url, provider_stream_id, status, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'live', now())
     RETURNING id`,
    [userId, input.title, input.category ?? null, input.language ?? null, playbackUrl, profile.stream_key]
  );
  const streamId = rows[0]!.id;

  await flagIfMatched("stream_title", streamId, userId, input.title);

  return getStreamById(streamId);
}

export async function endStream(userId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE streams SET status = 'ended', ended_at = now()
     WHERE creator_id = $1 AND status = 'live'`,
    [userId]
  );
  if (!rowCount) throw new AppError(404, "No live stream to end");
}

// Shared by reapStaleStreams below — unlike endStream()/markEndedByProviderStreamId(),
// this ends a specific stream by id rather than scoping by creator/provider key, since
// the reaper isn't acting on behalf of any particular caller.
async function endStreamById(streamId: string): Promise<void> {
  await pool.query(`UPDATE streams SET status = 'ended', ended_at = now() WHERE id = $1`, [streamId]);
}

const STALE_STREAM_MAX_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours
const PLAYBACK_CHECK_TIMEOUT_MS = 5_000;

async function isPlaybackUrlReachable(playbackUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYBACK_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(playbackUrl, { method: "HEAD", signal: controller.signal });
    return res.ok;
  } catch {
    // Timeout, DNS failure, connection refused, TLS error, etc. — all read
    // as "not actually live" for our purposes.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

interface LiveStreamRow {
  id: string;
  playback_url: string | null;
  started_at: string | null;
}

// goLive() (above) flips a stream's status to 'live' the moment a creator
// clicks "Go live" in the dashboard — independent of whether their
// OBS/encoder has actually connected via RTMP yet. When a creator clicks Go
// Live but never gets their encoder working (or it disconnects uncleanly,
// e.g. mid-test), the on_unpublish webhook that would normally flip status
// back to 'ended' never fires, since a publish never truly started. The
// stream is then stuck showing "live" with zero video indefinitely.
//
// This sweeps every 'live' stream (see server.ts for the interval that
// calls it) and force-ends any that are actually dead, via two independent
// checks:
//   1. An HTTP HEAD against the stream's playback_url — a non-2xx (or a
//      timeout/connection failure) means there's nothing actually playing.
//   2. A hard backstop: any stream still marked 'live' after 12h is ended
//      regardless of what the HEAD check said, since a real live stream
//      running that long is implausible for this product. This catches
//      whatever the HTTP check might miss (e.g. a stale-but-still-technically
//      -200 URL).
// Each stream is checked independently — one stream's check failing (e.g.
// a network blip) must not stop the sweep from reaching the rest.
export async function reapStaleStreams(): Promise<void> {
  const { rows } = await pool.query<LiveStreamRow>(
    `SELECT id, playback_url, started_at FROM streams WHERE status = 'live'`
  );

  for (const row of rows) {
    try {
      const startedAtMs = row.started_at ? new Date(row.started_at).getTime() : null;
      const isPastMaxDuration =
        startedAtMs !== null && Date.now() - startedAtMs > STALE_STREAM_MAX_DURATION_MS;

      if (isPastMaxDuration) {
        await endStreamById(row.id);
        console.log(`[reaper] ended stream ${row.id}: max duration exceeded`);
        continue;
      }

      const reachable = row.playback_url ? await isPlaybackUrlReachable(row.playback_url) : false;
      if (!reachable) {
        await endStreamById(row.id);
        console.log(`[reaper] ended stream ${row.id}: no playback`);
      }
    } catch (err) {
      console.error(`[reaper] failed checking stream ${row.id}:`, err);
    }
  }
}

export async function markLiveByProviderStreamId(providerStreamId: string): Promise<void> {
  const profile = await pool.query<CreatorProfileRow>(
    `SELECT user_id, stream_key FROM creator_profiles WHERE stream_key = $1`,
    [providerStreamId]
  );
  const creatorId = profile.rows[0]?.user_id;
  if (!creatorId) throw new AppError(404, "Unknown provider stream id");

  // SRS's on_publish callback carries no playback URL — build it ourselves.
  const playbackUrl = videoProvider.getPlaybackUrl(providerStreamId);

  // Reuse whichever row is already tracking this creator's current session:
  // either a pending 'offline' row, or — the browser/WHIP go-live flow's
  // only path — a row goLive() already flipped to 'live' moments earlier,
  // before the WHIP publish actually landed. Without matching 'live' here
  // too, that flow always falls through to the INSERT below and produces a
  // second live row for the same stream.
  const pending = await pool.query<{ id: string }>(
    `SELECT id FROM streams WHERE creator_id = $1 AND status IN ('offline', 'live')
     ORDER BY created_at DESC LIMIT 1`,
    [creatorId]
  );

  if (pending.rows[0]) {
    await pool.query(
      `UPDATE streams SET status = 'live', playback_url = $1, started_at = now() WHERE id = $2`,
      [playbackUrl, pending.rows[0].id]
    );
    return;
  }

  await pool.query(
    `INSERT INTO streams (creator_id, title, playback_url, provider_stream_id, status, started_at)
     VALUES ($1, 'Live Stream', $2, $3, 'live', now())`,
    [creatorId, playbackUrl, providerStreamId]
  );
}

export async function markEndedByProviderStreamId(providerStreamId: string): Promise<void> {
  const profile = await pool.query<CreatorProfileRow>(
    `SELECT user_id FROM creator_profiles WHERE stream_key = $1`,
    [providerStreamId]
  );
  const creatorId = profile.rows[0]?.user_id;
  if (!creatorId) throw new AppError(404, "Unknown provider stream id");

  await pool.query(
    `UPDATE streams SET status = 'ended', ended_at = now()
     WHERE creator_id = $1 AND status = 'live'`,
    [creatorId]
  );
}

