import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AspectRatio, Clip, CreateClipInput, PublicClip } from "@birq/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { deleteObject, getSignedVodUrl, isObjectStorageConfigured, uploadObject } from "../common/object-storage.js";

const execFileAsync = promisify(execFile);

// Real ffmpeg crop+scale to a 1080x1920 (9:16) H.264/AAC clip — no npm
// wrapper package, this shells out to the actual binary (installed in
// the runner image, see apps/api/Dockerfile) via execFile with an
// argument ARRAY, never a shell string — command injection into ffmpeg
// via a crafted title/id is exactly the class of bug an array-form
// execFile call structurally can't have (see BIRQ security guidelines
// Part III §9's "FFmpeg parameter sanitization" concern — the real
// mitigation here is never building a shell command string at all, not
// sanitizing one after the fact).
//
// -ss before -i (fast seek, jumps to the keyframe search point before
// decoding starts) rather than after — for a 60s-max clip out of a VOD
// that can be hours long, decoding from the start every time would be
// far slower and this is meant to run synchronously in an HTTP request.
// crop=ih*9/16:ih centers a 9:16 slice out of whatever the source aspect
// ratio actually is, then scale to a fixed 1080x1920 output.
async function runFfmpegClip(sourceUrl: string, startSeconds: number, durationSeconds: number): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "birq-clip-"));
  const outputPath = join(workDir, "clip.mp4");
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-ss", String(startSeconds),
        "-i", sourceUrl,
        "-t", String(durationSeconds),
        "-vf", "crop=ih*9/16:ih,scale=1080:1920",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y",
        outputPath,
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 10 }
    );
    return await readFile(outputPath);
  } catch (err) {
    throw new AppError(500, `Clip generation failed: ${err instanceof Error ? err.message : "unknown error"}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

interface ClipRow {
  id: string;
  vod_id: string;
  title: string | null;
  object_key: string;
  start_seconds: number;
  duration_seconds: number;
  aspect_ratio: AspectRatio;
  created_at: string;
}

async function toClip(row: ClipRow): Promise<Clip> {
  return {
    id: row.id,
    vodId: row.vod_id,
    title: row.title,
    playbackUrl: await getSignedVodUrl(row.object_key),
    startSeconds: row.start_seconds,
    durationSeconds: row.duration_seconds,
    aspectRatio: row.aspect_ratio,
    createdAt: row.created_at,
  };
}

export async function createClip(userId: string, vodId: string, input: CreateClipInput): Promise<Clip> {
  // Checked before running ffmpeg, not just left to uploadObject's own
  // internal check — failing fast here avoids burning real CPU/time on a
  // transcode that's already known to have nowhere to go.
  if (!isObjectStorageConfigured) {
    throw new AppError(503, "Clip creation isn't available right now — try again later.");
  }

  const { rows } = await pool.query<{ playback_url: string; duration_seconds: number | null }>(
    `SELECT v.playback_url, v.duration_seconds
     FROM stream_vods v
     JOIN streams s ON s.id = v.stream_id
     WHERE v.id = $1 AND s.creator_id = $2`,
    [vodId, userId]
  );
  const vod = rows[0];
  if (!vod) throw new AppError(404, "VOD not found");

  if (vod.duration_seconds !== null && input.startSeconds + input.durationSeconds > vod.duration_seconds) {
    throw new AppError(400, "Clip range extends past the end of the VOD");
  }

  const sourceUrl = await getSignedVodUrl(vod.playback_url);
  const clipBuffer = await runFfmpegClip(sourceUrl, input.startSeconds, input.durationSeconds);

  const objectKey = `clips/${userId}/${randomUUID()}.mp4`;
  await uploadObject(objectKey, clipBuffer, "video/mp4");

  const { rows: inserted } = await pool.query<ClipRow>(
    `INSERT INTO clips (vod_id, creator_id, title, object_key, start_seconds, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, vod_id, title, object_key, start_seconds, duration_seconds, aspect_ratio, created_at`,
    [vodId, userId, input.title ?? null, objectKey, input.startSeconds, input.durationSeconds]
  );
  return toClip(inserted[0]!);
}

export async function listClipsForCreator(username: string): Promise<Clip[]> {
  const { rows } = await pool.query<ClipRow>(
    `SELECT c.id, c.vod_id, c.title, c.object_key, c.start_seconds, c.duration_seconds, c.created_at
     FROM clips c
     JOIN users u ON u.id = c.creator_id
     WHERE u.username = $1 AND c.dmca_removed_at IS NULL
     ORDER BY c.created_at DESC
     LIMIT 20`,
    [username]
  );
  return Promise.all(rows.map(toClip));
}

interface PublicClipRow {
  id: string;
  title: string | null;
  object_key: string;
  duration_seconds: number;
  aspect_ratio: AspectRatio;
  created_at: string;
  views: number;
  category: string | null;
  creator_username: string;
  creator_display_name: string;
  creator_avatar_url: string | null;
}

async function toPublicClip(row: PublicClipRow): Promise<PublicClip> {
  return {
    id: row.id,
    title: row.title,
    playbackUrl: await getSignedVodUrl(row.object_key),
    durationSeconds: row.duration_seconds,
    aspectRatio: row.aspect_ratio,
    createdAt: row.created_at,
    views: row.views,
    category: row.category,
    creatorUsername: row.creator_username,
    creatorDisplayName: row.creator_display_name,
    creatorAvatarUrl: row.creator_avatar_url,
  };
}

const PUBLIC_CLIP_SELECT = `SELECT c.id, c.title, c.object_key, c.duration_seconds, c.aspect_ratio, c.created_at, c.views,
            COALESCE(v.category, s.category) AS category,
            u.username AS creator_username, u.display_name AS creator_display_name, u.avatar_url AS creator_avatar_url
     FROM clips c
     JOIN stream_vods v ON v.id = c.vod_id
     JOIN streams s ON s.id = v.stream_id
     JOIN users u ON u.id = c.creator_id`;

// Phase 3.1 — the public, independently-shareable clip page. category
// mirrors vods/service.ts's own COALESCE(v.category, s.category) pattern
// (0028_vod_publish_workflow.sql): a clip's source VOD can override the
// parent stream's category, falling back to it otherwise. dmca_removed_at
// IS NULL is the same enforcement point vods/service.ts's public listing
// already uses — a takedown-flagged clip must 404 here too, not just
// disappear from listClipsForCreator.
export async function getPublicClipById(clipId: string): Promise<PublicClip | null> {
  const { rows } = await pool.query<PublicClipRow>(
    `${PUBLIC_CLIP_SELECT} WHERE c.id = $1 AND c.dmca_removed_at IS NULL`,
    [clipId]
  );
  const row = rows[0];
  return row ? toPublicClip(row) : null;
}

// Phase 3.3 — category detail page's Clips tab. Reuses PublicClip
// (already built for Phase 3.1's public clip page) rather than a third
// type — same shape a cross-creator feed needs either way: attribution,
// category, views. Same 24-item cap as listVodsByCategory's sibling
// query — a browse feed, not a paginated archive.
export async function listClipsByCategory(category: string): Promise<PublicClip[]> {
  const { rows } = await pool.query<PublicClipRow>(
    `${PUBLIC_CLIP_SELECT}
     WHERE COALESCE(v.category, s.category) = $1 AND c.dmca_removed_at IS NULL
     ORDER BY c.created_at DESC
     LIMIT 24`,
    [category]
  );
  return Promise.all(rows.map(toPublicClip));
}

// Phase 3.6 — /discover's trending section. Recency-weighted (last 30
// days — clips don't expire the way VODs do, see listTrendingVods' own
// comment on why that one uses a tighter 14-day window), not all-time
// views: an old viral clip permanently dominating "trending" with no way
// for new content to surface would make the word a lie.
export async function listTrendingClips(): Promise<PublicClip[]> {
  const { rows } = await pool.query<PublicClipRow>(
    `${PUBLIC_CLIP_SELECT}
     WHERE c.dmca_removed_at IS NULL AND c.created_at > now() - interval '30 days'
     ORDER BY c.views DESC, c.created_at DESC
     LIMIT 12`
  );
  return Promise.all(rows.map(toPublicClip));
}

// Public, unauthenticated — same trust level and same "count a play, not
// an impression" convention as vods/service.ts's incrementVodViews
// (fired once by the client on first playback, not on page load).
export async function incrementClipViews(clipId: string): Promise<void> {
  await pool.query(`UPDATE clips SET views = views + 1 WHERE id = $1 AND dmca_removed_at IS NULL`, [clipId]);
}

export async function deleteClipOwned(clipId: string, userId: string): Promise<void> {
  const { rows } = await pool.query<{ object_key: string }>(
    `DELETE FROM clips WHERE id = $1 AND creator_id = $2 RETURNING object_key`,
    [clipId, userId]
  );
  if (!rows[0]) throw new AppError(404, "Clip not found");
  await deleteObject(rows[0].object_key);
}
