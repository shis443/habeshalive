import type { PublicVod, PublishVodInput, Vod } from "@birq/shared";
import { getVodRetentionDays } from "../admin/config-service.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { deleteObject, getSignedVodUrl, uploadObject } from "../common/object-storage.js";

interface VodRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  thumbnail_url: string | null;
  playback_url: string;
  duration_seconds: number | null;
  views: number;
  is_published: boolean;
  created_at: string;
}

async function toVod(row: VodRow): Promise<Vod> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    thumbnailUrl: row.thumbnail_url,
    playbackUrl: await getSignedVodUrl(row.playback_url),
    durationSeconds: row.duration_seconds,
    views: row.views,
    isPublished: row.is_published,
    createdAt: row.created_at,
  };
}

// stream_vods.playback_url stores the bucket key, not a URL — signed into
// a real, short-lived URL here on every read (see
// common/object-storage.ts's getSignedVodUrl) rather than once at write
// time, so a link handed to one viewer can't be replayed indefinitely.
//
// Public path (GET /vods/:username, no auth) — is_published = true only.
// title/category COALESCE to the parent stream's values when a creator
// hasn't set a per-VOD override (db/migrations/0028's own comment);
// description has no such fallback, streams has no description column.
export async function listVodsForCreator(username: string): Promise<Vod[]> {
  const { rows } = await pool.query<VodRow>(
    `SELECT v.id, COALESCE(v.title, s.title) AS title, v.description,
            COALESCE(v.category, s.category) AS category, s.thumbnail_url,
            v.playback_url, v.duration_seconds, v.views, v.is_published, v.created_at
     FROM stream_vods v
     JOIN streams s ON s.id = v.stream_id
     JOIN users u ON u.id = s.creator_id
     WHERE u.username = $1 AND v.expires_at > now() AND v.is_published = true AND v.dmca_removed_at IS NULL
     ORDER BY v.created_at DESC`,
    [username]
  );
  return Promise.all(rows.map(toVod));
}

interface PublicVodRow extends VodRow {
  creator_username: string;
  creator_display_name: string;
  creator_avatar_url: string | null;
}

async function toPublicVod(row: PublicVodRow): Promise<PublicVod> {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    thumbnailUrl: row.thumbnail_url,
    playbackUrl: await getSignedVodUrl(row.playback_url),
    durationSeconds: row.duration_seconds,
    views: row.views,
    createdAt: row.created_at,
    creatorUsername: row.creator_username,
    creatorDisplayName: row.creator_display_name,
    creatorAvatarUrl: row.creator_avatar_url,
  };
}

const PUBLIC_VOD_SELECT = `SELECT v.id, COALESCE(v.title, s.title) AS title, v.description,
            COALESCE(v.category, s.category) AS category, s.thumbnail_url,
            v.playback_url, v.duration_seconds, v.views, v.is_published, v.created_at,
            u.username AS creator_username, u.display_name AS creator_display_name, u.avatar_url AS creator_avatar_url
     FROM stream_vods v
     JOIN streams s ON s.id = v.stream_id
     JOIN users u ON u.id = s.creator_id
     WHERE v.expires_at > now() AND v.is_published = true AND v.dmca_removed_at IS NULL`;

// Phase 3.3 — category detail page's Videos tab. Same public/is_published
// gate as listVodsForCreator above, just filtered by category across all
// creators instead of by username for one. Capped at 24 — this is a
// browse feed, not a paginated archive; no "load more" exists yet on
// either the category page or listVodsForCreator's own equivalent.
export async function listVodsByCategory(category: string): Promise<PublicVod[]> {
  const { rows } = await pool.query<PublicVodRow>(
    `${PUBLIC_VOD_SELECT} AND COALESCE(v.category, s.category) = $1
     ORDER BY v.created_at DESC
     LIMIT 24`,
    [category]
  );
  return Promise.all(rows.map(toPublicVod));
}

// Phase 3.6 — /discover's trending section. Recency-weighted (last 14
// days), not all-time views — an old viral VOD permanently dominating a
// "trending" list with no way for new content to surface would make the
// word "trending" a lie. 14 days rather than clips' own 30 (below) since
// a VOD expires and disappears from the platform entirely on its own
// schedule (v.expires_at, db/migrations/0028) — trending here leans
// toward "still fresh," not just "still technically visible."
export async function listTrendingVods(): Promise<PublicVod[]> {
  const { rows } = await pool.query<PublicVodRow>(
    `${PUBLIC_VOD_SELECT} AND v.created_at > now() - interval '14 days'
     ORDER BY v.views DESC, v.created_at DESC
     LIMIT 12`
  );
  return Promise.all(rows.map(toPublicVod));
}

// Authenticated — a creator managing their own channel needs to see
// drafts too (the whole point of the publish workflow), unlike the public
// path above. Ownership is the query itself (JOIN streams ON creator_id =
// $1), not a separate check, so there's no way to pass someone else's
// userId and see their drafts.
export async function listMyVods(userId: string): Promise<Vod[]> {
  const { rows } = await pool.query<VodRow>(
    `SELECT v.id, COALESCE(v.title, s.title) AS title, v.description,
            COALESCE(v.category, s.category) AS category, s.thumbnail_url,
            v.playback_url, v.duration_seconds, v.views, v.is_published, v.created_at
     FROM stream_vods v
     JOIN streams s ON s.id = v.stream_id
     WHERE s.creator_id = $1 AND v.expires_at > now()
     ORDER BY v.created_at DESC`,
    [userId]
  );
  return Promise.all(rows.map(toVod));
}

// Same ownership pattern for all three mutations below: JOIN through to
// streams.creator_id in the same query that does the write, rather than a
// separate SELECT-then-check — a TOCTOU-safe single round trip, and if
// updated/rows.length is 0 the caller genuinely can't distinguish "VOD
// doesn't exist" from "exists but isn't yours", which is the correct,
// non-leaky behavior for a 404 either way.

export async function publishVod(vodId: string, userId: string, input: PublishVodInput): Promise<Vod> {
  const { rows } = await pool.query<VodRow>(
    `UPDATE stream_vods v
     SET is_published = true,
         title = COALESCE($3, v.title),
         description = COALESCE($4, v.description),
         category = COALESCE($5, v.category)
     FROM streams s
     WHERE v.id = $1 AND v.stream_id = s.id AND s.creator_id = $2
     RETURNING v.id, COALESCE(v.title, s.title) AS title, v.description,
               COALESCE(v.category, s.category) AS category, s.thumbnail_url,
               v.playback_url, v.duration_seconds, v.views, v.is_published, v.created_at`,
    [vodId, userId, input.title ?? null, input.description ?? null, input.category ?? null]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "VOD not found");
  return toVod(row);
}

export async function unpublishVod(vodId: string, userId: string): Promise<Vod> {
  const { rows } = await pool.query<VodRow>(
    `UPDATE stream_vods v
     SET is_published = false
     FROM streams s
     WHERE v.id = $1 AND v.stream_id = s.id AND s.creator_id = $2
     RETURNING v.id, COALESCE(v.title, s.title) AS title, v.description,
               COALESCE(v.category, s.category) AS category, s.thumbnail_url,
               v.playback_url, v.duration_seconds, v.views, v.is_published, v.created_at`,
    [vodId, userId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "VOD not found");
  return toVod(row);
}

export async function deleteVodOwned(vodId: string, userId: string): Promise<void> {
  const { rows } = await pool.query<{ playback_url: string }>(
    `SELECT v.playback_url FROM stream_vods v
     JOIN streams s ON s.id = v.stream_id
     WHERE v.id = $1 AND s.creator_id = $2`,
    [vodId, userId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "VOD not found");
  // Object storage first: if this throws, the DB row (and thus the
  // creator's ability to retry the delete) is still there — deleting the
  // DB row first and having the object-storage delete fail would instead
  // orphan the file with nothing left pointing at it to clean up.
  await deleteObject(row.playback_url);
  await pool.query(`DELETE FROM stream_vods WHERE id = $1`, [vodId]);
}

// Public, unauthenticated (same trust level as a Twitch/YouTube view
// counter) — but only counts against a published VOD, both so a draft
// nobody can even see yet can't accumulate views, and so this can't be
// used as a side channel to probe whether an arbitrary VOD id exists.
export async function incrementVodViews(vodId: string): Promise<void> {
  await pool.query(
    `UPDATE stream_vods SET views = views + 1 WHERE id = $1 AND is_published = true AND dmca_removed_at IS NULL`,
    [vodId]
  );
}

// Called from the SRS on_dvr webhook (streams/routes.ts's
// /webhooks/vod-ready) once a stream's recording is ready. is_published
// defaults to false (db/migrations/0028_vod_publish_workflow.sql) — every
// new recording starts as a draft; the dashboard's "stream ended" prompt
// (GET /vods/mine, filtered client-side to unpublished) is what lets a
// creator actually publish it.
export async function createVodFromRecording(streamId: string, fileUrl: string): Promise<Vod> {
  const streamResult = await pool.query<{ creator_id: string; is_anchor_creator: boolean }>(
    `SELECT s.creator_id, cp.is_anchor_creator
     FROM streams s JOIN creator_profiles cp ON cp.user_id = s.creator_id
     WHERE s.id = $1`,
    [streamId]
  );
  const stream = streamResult.rows[0];
  if (!stream) throw new Error(`Unknown stream ${streamId}`);

  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error(`Failed to fetch recording from ${fileUrl}: ${fileRes.status}`);
  const body = Buffer.from(await fileRes.arrayBuffer());

  const key = `${streamId}/${Date.now()}.mp4`;
  await uploadObject(key, body, "video/mp4");

  const retention = await getVodRetentionDays();
  const retentionDays = stream.is_anchor_creator ? retention.anchor : retention.default;

  const { rows } = await pool.query<{
    id: string;
    title: string | null;
    description: string | null;
    category: string | null;
    playback_url: string;
    duration_seconds: number | null;
    views: number;
    is_published: boolean;
    created_at: string;
  }>(
    `INSERT INTO stream_vods (stream_id, playback_url, expires_at)
     VALUES ($1, $2, now() + interval '1 day' * $3)
     RETURNING id, title, description, category, playback_url, duration_seconds, views, is_published, created_at`,
    [streamId, key, retentionDays]
  );
  const inserted = rows[0]!;

  const streamRow = await pool.query<{ title: string; category: string | null; thumbnail_url: string | null }>(
    `SELECT title, category, thumbnail_url FROM streams WHERE id = $1`,
    [streamId]
  );
  const parentStream = streamRow.rows[0]!;

  return toVod({
    ...inserted,
    title: inserted.title ?? parentStream.title,
    category: inserted.category ?? parentStream.category,
    thumbnail_url: parentStream.thumbnail_url,
  });
}

// Daily cron (see server.ts) — deletes both the DB row and the underlying
// object storage file for anything past its retention window. Each VOD is
// handled independently so one bad object-storage key can't stop the rest
// of the sweep, same reasoning as reapStaleStreams/renewSubscriptions.
export async function cleanupExpiredVods(): Promise<void> {
  const { rows } = await pool.query<{ id: string; playback_url: string }>(
    `SELECT id, playback_url FROM stream_vods WHERE expires_at < now()`
  );
  for (const row of rows) {
    try {
      await deleteObject(row.playback_url);
      await pool.query(`DELETE FROM stream_vods WHERE id = $1`, [row.id]);
      console.log(`[vods] cleaned up expired vod ${row.id}`);
    } catch (err) {
      console.error(`[vods] failed cleaning up ${row.id}:`, err);
    }
  }
}
