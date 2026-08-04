import type { Vod } from "@habeshalive/shared";
import { getVodRetentionDays } from "../admin/config-service.js";
import { pool } from "../common/db.js";
import { deleteObject, getSignedVodUrl, uploadObject } from "../common/object-storage.js";

interface VodRow {
  id: string;
  title: string;
  thumbnail_url: string | null;
  playback_url: string;
  duration_seconds: number | null;
  created_at: string;
}

// stream_vods.playback_url stores the bucket key, not a URL — signed into
// a real, short-lived URL here on every read (see
// common/object-storage.ts's getSignedVodUrl) rather than once at write
// time, so a link handed to one viewer can't be replayed indefinitely.
export async function listVodsForCreator(username: string): Promise<Vod[]> {
  const { rows } = await pool.query<VodRow>(
    `SELECT v.id, s.title, s.thumbnail_url, v.playback_url, v.duration_seconds, v.created_at
     FROM stream_vods v
     JOIN streams s ON s.id = v.stream_id
     JOIN users u ON u.id = s.creator_id
     WHERE u.username = $1 AND v.expires_at > now()
     ORDER BY v.created_at DESC`,
    [username]
  );
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      title: row.title,
      thumbnailUrl: row.thumbnail_url,
      playbackUrl: await getSignedVodUrl(row.playback_url),
      durationSeconds: row.duration_seconds,
      createdAt: row.created_at,
    }))
  );
}

// Called from the SRS on_dvr webhook once recording is actually wired up
// (see streams/routes.ts's /webhooks/vod-ready and the comment there for
// exactly what's still missing — this function itself is real and tested
// against a real file, just never yet invoked by a live SRS callback).
// fileUrl must be a URL this API can fetch over HTTP — SRS's own
// http_server already serves recorded files the same way it serves HLS
// segments, so no separate file-transfer mechanism is needed.
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

  const { rows } = await pool.query<{ id: string; created_at: string }>(
    `INSERT INTO stream_vods (stream_id, playback_url, expires_at)
     VALUES ($1, $2, now() + interval '1 day' * $3)
     RETURNING id, created_at`,
    [streamId, key, retentionDays]
  );

  const titleResult = await pool.query<{ title: string; thumbnail_url: string | null }>(
    `SELECT title, thumbnail_url FROM streams WHERE id = $1`,
    [streamId]
  );

  return {
    id: rows[0]!.id,
    title: titleResult.rows[0]!.title,
    thumbnailUrl: titleResult.rows[0]!.thumbnail_url,
    playbackUrl: await getSignedVodUrl(key),
    durationSeconds: null,
    createdAt: rows[0]!.created_at,
  };
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

