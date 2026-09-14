import type { CreateScheduledStreamInput, ScheduledStream } from "@birq/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { flagIfImageMatched, flagIfMatched } from "../moderation/service.js";
import { notifyFollowersStreamScheduled } from "../notifications/service.js";
import { ensureCreatorProfile } from "./service.js";

interface ScheduledStreamRow {
  id: string;
  creator_id: string;
  username: string;
  display_name: string;
  title: string;
  caption: string | null;
  category: string | null;
  language: string | null;
  scheduled_at: string;
  thumbnail_url: string | null;
  status: "scheduled" | "live" | "cancelled";
  stream_id: string | null;
  created_at: string;
}

const SELECT_COLUMNS = `s.id, s.creator_id, u.username, u.display_name, s.title, s.caption, s.category, s.language,
  s.scheduled_at, s.thumbnail_url, s.status, s.stream_id, s.created_at`;

function toScheduledStream(row: ScheduledStreamRow): ScheduledStream {
  return {
    id: row.id,
    creatorId: row.creator_id,
    creatorUsername: row.username,
    creatorDisplayName: row.display_name,
    title: row.title,
    caption: row.caption,
    category: row.category,
    language: row.language,
    scheduledAt: row.scheduled_at,
    thumbnailUrl: row.thumbnail_url,
    status: row.status,
    streamId: row.stream_id,
    createdAt: row.created_at,
  };
}

// Replaces any existing pending schedule rather than erroring or stacking
// a second one — db/migrations/0066's partial unique index only allows one
// 'scheduled' row per creator at a time, so resubmitting the form (to
// edit title/time/etc.) is the only "edit" flow this needs.
export async function createOrReplaceScheduledStream(
  creatorId: string,
  input: CreateScheduledStreamInput
): Promise<ScheduledStream> {
  await ensureCreatorProfile(creatorId);

  const scheduledAtMs = new Date(input.scheduledAt).getTime();
  if (Number.isNaN(scheduledAtMs) || scheduledAtMs <= Date.now()) {
    throw new AppError(400, "scheduledAt must be a real time in the future");
  }

  await pool.query(`DELETE FROM scheduled_streams WHERE creator_id = $1 AND status = 'scheduled'`, [
    creatorId,
  ]);

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO scheduled_streams (creator_id, title, caption, category, language, scheduled_at, thumbnail_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      creatorId,
      input.title,
      input.caption ?? null,
      input.category ?? null,
      input.language ?? null,
      input.scheduledAt,
      input.thumbnailUrl ?? null,
    ]
  );
  const scheduledStreamId = rows[0]!.id;

  await flagIfMatched("stream_title", scheduledStreamId, creatorId, input.title);
  if (input.thumbnailUrl) {
    await flagIfImageMatched("stream_thumbnail", scheduledStreamId, creatorId, input.thumbnailUrl);
  }

  const created = await getScheduledStreamById(scheduledStreamId);
  // Detached, best-effort — same posture as every other follower fan-out
  // notification in this codebase (goLive's own notifyFollowersCreatorLive
  // call is the precedent).
  notifyFollowersStreamScheduled(creatorId, created!.creatorUsername, created!.creatorDisplayName).catch((err) => {
    console.error("[scheduled-streams] notifyFollowersStreamScheduled failed:", err);
  });
  return created!;
}

async function getScheduledStreamById(id: string): Promise<ScheduledStream | null> {
  const { rows } = await pool.query<ScheduledStreamRow>(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_streams s JOIN users u ON u.id = s.creator_id WHERE s.id = $1`,
    [id]
  );
  return rows[0] ? toScheduledStream(rows[0]) : null;
}

// A creator's own pending schedule, for their stream-manager dashboard —
// null when they have none (not an error; "nothing scheduled" is a normal
// state).
export async function getMyScheduledStream(creatorId: string): Promise<ScheduledStream | null> {
  const { rows } = await pool.query<ScheduledStreamRow>(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_streams s JOIN users u ON u.id = s.creator_id
     WHERE s.creator_id = $1 AND s.status = 'scheduled'`,
    [creatorId]
  );
  return rows[0] ? toScheduledStream(rows[0]) : null;
}

// Public — the audience "Upcoming Stream" card on a creator's channel
// page. Same null-is-a-real-state posture as above.
export async function getScheduledStreamForUsername(username: string): Promise<ScheduledStream | null> {
  const { rows } = await pool.query<ScheduledStreamRow>(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_streams s JOIN users u ON u.id = s.creator_id
     WHERE u.username = $1 AND s.status = 'scheduled'`,
    [username]
  );
  return rows[0] ? toScheduledStream(rows[0]) : null;
}

export async function cancelScheduledStream(creatorId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE scheduled_streams SET status = 'cancelled' WHERE creator_id = $1 AND status = 'scheduled'`,
    [creatorId]
  );
  if (!rowCount) throw new AppError(404, "No pending scheduled stream to cancel");
}

// Called from streams/service.ts's promoteStartingStreams() the moment a
// stream is actually confirmed live — deliberately NOT hooked into
// goLive() itself, since that only covers the WHIP/browser path (see
// promoteStartingStreams's own comment on why RTMP never reaches goLive's
// notification calls). This hook point covers both ingest paths, since
// every 'starting' row — regardless of origin — passes through here on
// its way to 'live'.
export async function promoteScheduledStreamsForCreator(creatorId: string, streamId: string): Promise<void> {
  await pool.query(
    `UPDATE scheduled_streams SET status = 'live', stream_id = $2
     WHERE creator_id = $1 AND status = 'scheduled'`,
    [creatorId, streamId]
  );
}

// A schedule whose time has long passed with no matching stream ever
// going live (creator forgot, or never actually started) shouldn't hang
// on a channel page's countdown forever — flips it to 'cancelled' after a
// grace window, same "each row independent, one failure doesn't stop the
// sweep" posture as reapStaleStreams/promoteStartingStreams.
const STALE_SCHEDULE_GRACE_MS = 6 * 60 * 60_000;

export async function autoCancelStaleScheduledStreams(): Promise<void> {
  await pool.query(
    `UPDATE scheduled_streams SET status = 'cancelled'
     WHERE status = 'scheduled' AND scheduled_at < now() - ($1 || ' milliseconds')::interval`,
    [STALE_SCHEDULE_GRACE_MS]
  );
}
