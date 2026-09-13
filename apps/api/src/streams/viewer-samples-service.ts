import { pool } from "../common/db.js";
import { env } from "../common/env.js";

// 90 days: matches the retention window in 0056_stream_viewer_samples.sql's
// own comment.
const RETENTION_DAYS = 90;

interface PresenceStatsResult {
  result?: { num_clients?: number; num_users?: number };
}

// num_users, not num_clients — verified against a real running Centrifugo
// instance (dev-only-change-me key, a real WebSocket client subscribed to
// a real channel) that num_users dedupes multiple connections from the
// same "sub" (a real user with two tabs open, or two devices) the same
// way getViewerList's own presence-based counting already does, while
// num_clients counts each connection separately. presence_stats is used
// instead of the full presence call getViewerList makes — this only
// needs a count, not the per-client list, so it skips that payload
// entirely for a live sampler running every 60s across every stream.
// Returns null, not 0, when the count couldn't be determined — a
// Centrifugo blip should leave a gap in that stream's samples for this
// interval, not a fabricated "0 viewers" that would understate its
// viewer-seconds and (via peak_viewers' GREATEST below) can never do any
// harm either way, but WOULD corrupt the average if recorded as a real
// zero-viewer sample.
async function getLiveViewerCount(streamId: string): Promise<number | null> {
  try {
    const res = await fetch(`${env.CENTRIFUGO_URL}/api`, {
      method: "POST",
      headers: { "X-API-Key": env.CENTRIFUGO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ method: "presence_stats", params: { channel: `stream-chat:${streamId}` } }),
    });
    if (!res.ok) {
      console.error(`[viewer-samples] Centrifugo presence_stats failed for ${streamId}: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as PresenceStatsResult;
    return data.result?.num_users ?? 0;
  } catch (err) {
    console.error(`[viewer-samples] Centrifugo presence_stats request failed for ${streamId}:`, err);
    return null;
  }
}

// Runs every 60s (see server.ts) against every currently live stream.
// Writes one stream_viewer_samples row per stream at a single shared
// timestamp for this run — SUM(viewer_count) * 60 across a stream's rows
// is its viewer-seconds, and the raw rows are its CCU curve.
//
// Also updates streams.peak_viewers (GREATEST, never decreases) — this
// column existed since 0001_init.sql and is read everywhere (stream
// cards, search ranking, category totals, follows' "currently watching",
// ad targeting) but was never written by any code in this repo before
// this function, so every stream's displayed/ranked-by viewer count has
// always silently been its DEFAULT 0. Fixed here rather than separately,
// since the live count this needs is already being fetched for the
// sample row — confirmed with the user before wiring it in, given how
// much of the product this makes suddenly show real numbers.
export async function sampleLiveViewerCounts(): Promise<void> {
  const { rows: liveStreams } = await pool.query<{ id: string }>(`SELECT id FROM streams WHERE status = 'live'`);
  if (liveStreams.length === 0) return;

  const sampledAt = new Date();
  for (const { id: streamId } of liveStreams) {
    const viewerCount = await getLiveViewerCount(streamId);
    if (viewerCount === null) continue;
    await pool.query(
      `INSERT INTO stream_viewer_samples (stream_id, sampled_at, viewer_count) VALUES ($1, $2, $3)
       ON CONFLICT (stream_id, sampled_at) DO NOTHING`,
      [streamId, sampledAt, viewerCount]
    );
    await pool.query(`UPDATE streams SET peak_viewers = GREATEST(peak_viewers, $2) WHERE id = $1`, [
      streamId,
      viewerCount,
    ]);
  }
}

// Rolls samples older than the retention window into stream_watch_time_
// daily and deletes them — one (stream_id, day) group at a time so a
// crash between the upsert and the delete for one group never touches
// groups already committed. "day" is the Africa/Addis_Ababa calendar day
// each sample's sampled_at falls on (ground rule 8).
//
// Idempotent under retry: the upsert always recomputes a group's
// aggregate from whatever raw rows currently exist for it (REPLACE, not
// additive), so a retry after a crash between upsert and delete
// recomputes the same numbers rather than double-counting.
export async function rollupStaleViewerSamples(): Promise<number> {
  const { rows: groups } = await pool.query<{ stream_id: string; day: string }>(
    `SELECT DISTINCT stream_id, (sampled_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day
     FROM stream_viewer_samples
     WHERE sampled_at < now() - ($1 || ' days')::interval`,
    [RETENTION_DAYS]
  );

  for (const { stream_id, day } of groups) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO stream_watch_time_daily (stream_id, day, sample_count, viewer_seconds, peak_viewer_count, computed_at)
         SELECT $1, $2::date, COUNT(*), COALESCE(SUM(viewer_count), 0) * 60, COALESCE(MAX(viewer_count), 0), now()
         FROM stream_viewer_samples
         WHERE stream_id = $1 AND (sampled_at AT TIME ZONE 'Africa/Addis_Ababa')::date = $2::date
         ON CONFLICT (stream_id, day) DO UPDATE SET
           sample_count = EXCLUDED.sample_count,
           viewer_seconds = EXCLUDED.viewer_seconds,
           peak_viewer_count = EXCLUDED.peak_viewer_count,
           computed_at = EXCLUDED.computed_at`,
        [stream_id, day]
      );
      await client.query(
        `DELETE FROM stream_viewer_samples
         WHERE stream_id = $1 AND (sampled_at AT TIME ZONE 'Africa/Addis_Ababa')::date = $2::date`,
        [stream_id, day]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return groups.length;
}
