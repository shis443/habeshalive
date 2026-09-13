// Admin emergency stream controls beyond forceEndStream (streams/service.ts).
// forceEndStream stays where it is — it's tightly coupled to the streams
// table's own status transition. These three are grouped separately: two
// (mute/unmute) are self-enforcing DB writes with no external system to
// confirm against, and the third (revoke ingest) wraps an already-existing
// mechanism rather than inventing a new one.
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { rotateStreamKey } from "./service.js";
import { killPublisherConfirmed } from "../moderation/actions-service.js";

interface StreamAndCreator {
  id: string;
  creator_id: string;
}

async function getStreamOrThrow(streamId: string): Promise<StreamAndCreator> {
  const { rows } = await pool.query<StreamAndCreator>(`SELECT id, creator_id FROM streams WHERE id = $1`, [
    streamId,
  ]);
  if (!rows[0]) throw new AppError(404, "Stream not found");
  return rows[0];
}

// Both mute and unmute are complete the instant this commits — unlike
// forceEndStream's kill, there is no external system (SRS) to confirm
// against, since chat/service.ts's sendChatMessage reads this same row
// directly on every send. enforced_at = now() here means exactly what it
// says: the write is the entire mechanism, not a request that something
// else still has to confirm.
export async function muteStreamChat(adminId: string, streamId: string, reason: string): Promise<void> {
  const stream = await getStreamOrThrow(streamId);
  const before = await pool.query<{ chat_muted: boolean | null }>(
    `SELECT chat_muted FROM stream_controls WHERE stream_id = $1`,
    [streamId]
  );
  await pool.query(
    `INSERT INTO stream_controls (stream_id, chat_muted, reason, applied_by, enforced_at)
     VALUES ($1, TRUE, $2, $3, now())
     ON CONFLICT (stream_id) DO UPDATE
       SET chat_muted = TRUE, reason = $2, applied_by = $3, enforced_at = now(), updated_at = now()`,
    [streamId, reason, adminId]
  );
  await logAdminAction(adminId, "stream.mute_chat", "stream", stream.id, {
    reason,
    before: { chatMuted: before.rows[0]?.chat_muted ?? false },
    after: { chatMuted: true },
  });
}

export async function unmuteStreamChat(adminId: string, streamId: string, reason: string): Promise<void> {
  const stream = await getStreamOrThrow(streamId);
  const before = await pool.query<{ chat_muted: boolean | null }>(
    `SELECT chat_muted FROM stream_controls WHERE stream_id = $1`,
    [streamId]
  );
  if (!before.rows[0]?.chat_muted) throw new AppError(400, "Chat is not muted on this stream");
  await pool.query(
    `UPDATE stream_controls SET chat_muted = FALSE, reason = $2, applied_by = $3, enforced_at = now(), updated_at = now()
     WHERE stream_id = $1`,
    [streamId, reason, adminId]
  );
  await logAdminAction(adminId, "stream.unmute_chat", "stream", stream.id, {
    reason,
    before: { chatMuted: true },
    after: { chatMuted: false },
  });
}

// Wraps the already-existing, already-working rotateStreamKey (a creator's
// own self-service key rotation) with admin attribution and audit logging
// — deliberately not a separate mechanism. rotateStreamKey's own teardown
// of the currently-active publisher is fire-and-forget by design (see its
// own call to killActiveRtmpPublishers, and that function's documented
// reasoning): the real security boundary is the OLD key no longer
// authenticating any future publish, which is unconditional and immediate,
// not the best-effort disconnect of an already-open connection. This
// action is therefore logged as the rotation being done, not as a
// media-server kill being confirmed — those are different claims, and
// conflating them would overstate what actually happened.
//
// The new plaintext key is deliberately never passed to logAdminAction —
// an audit log is not where a live credential belongs, redacted or not.
export async function adminRevokeIngestKey(adminId: string, streamId: string, reason: string): Promise<void> {
  const stream = await getStreamOrThrow(streamId);
  const before = await pool.query<{ ingest_revoked: boolean | null }>(
    `SELECT ingest_revoked FROM stream_controls WHERE stream_id = $1`,
    [streamId]
  );
  await rotateStreamKey(stream.creator_id);
  await pool.query(
    `INSERT INTO stream_controls (stream_id, ingest_revoked, reason, applied_by, enforced_at)
     VALUES ($1, TRUE, $2, $3, now())
     ON CONFLICT (stream_id) DO UPDATE
       SET ingest_revoked = TRUE, reason = $2, applied_by = $3, enforced_at = now(), updated_at = now()`,
    [streamId, reason, adminId]
  );
  await logAdminAction(adminId, "stream.revoke_ingest", "stream", stream.id, {
    reason,
    before: { ingestRevoked: before.rows[0]?.ingest_revoked ?? false },
    after: { ingestRevoked: true },
  });
}

interface UnenforcedKill {
  stream_id: string;
  creator_id: string;
  srs_client_id: string | null;
  attempts: number;
}

// Retries a force-end whose kill was recorded but never confirmed — an
// SRS outage, a network blip, or (before migration 0051) a search that
// never finds the publisher because it already reconnected under a new
// client_id. Registered in server.ts alongside promoteStartingStreams and
// reapStaleStreams, on the same "each row checked independently, one
// failure doesn't stop the sweep" posture as both.
//
// Gives up after 20 attempts (stream_controls.attempts, already
// incremented by forceEndStream on every try, this function included) and
// records that in last_error rather than retrying forever — a publisher
// that has survived 20 real kill attempts against the actual media server
// is not a transient failure this loop is going to fix by trying a 21st
// time; it needs a human.
const MAX_RECONCILE_ATTEMPTS = 20;

export async function reconcileStreamControls(): Promise<void> {
  const { rows } = await pool.query<UnenforcedKill>(
    `SELECT sc.stream_id, s.creator_id, s.srs_client_id, sc.attempts
       FROM stream_controls sc
       JOIN streams s ON s.id = sc.stream_id
      WHERE sc.killed = TRUE AND sc.enforced_at IS NULL AND sc.attempts < $1`,
    [MAX_RECONCILE_ATTEMPTS]
  );

  for (const row of rows) {
    try {
      await killPublisherConfirmed(row.creator_id, { knownClientId: row.srs_client_id ?? undefined });
      await pool.query(
        `UPDATE stream_controls SET enforced_at = now(), last_error = NULL, attempts = attempts + 1, updated_at = now()
         WHERE stream_id = $1`,
        [row.stream_id]
      );
      console.log(`[reconcile] confirmed kill for stream ${row.stream_id} on retry`);
    } catch (err) {
      await pool.query(
        `UPDATE stream_controls SET last_error = $2, attempts = attempts + 1, updated_at = now()
         WHERE stream_id = $1`,
        [row.stream_id, (err as Error).message]
      );
      console.error(`[reconcile] kill still not confirmed for stream ${row.stream_id}:`, err);
    }
  }
}
