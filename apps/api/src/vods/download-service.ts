import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DownloadJobStatus } from "@birq/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { env } from "../common/env.js";
import { getSignedVodUrl, uploadObject } from "../common/object-storage.js";

const execFileAsync = promisify(execFile);

// Re-encodes the video stream with a burned-in "Birq.live / @handle"
// watermark bottom-right, audio stream copied untouched (only the video
// needs the drawtext filter, so there's no reason to re-encode audio too).
// Same real execFile-with-argument-array pattern as clip-service.ts's
// runFfmpegClip — command injection via a crafted title/handle is
// structurally impossible here since this never builds a shell string.
// watermarkText is always "Birq.live / @<username>" (see
// enqueueDownload below) — usernameSchema restricts usernames to
// [a-zA-Z0-9_]+, so it can never contain a character the drawtext filter
// treats specially (':', "'", '\'), no escaping needed.
//
// No timeout: a full VOD can run up to the ~12h reaper ceiling, and a
// watermark re-encode of a multi-hour source is a genuinely long-running
// job by nature, not something to arbitrarily kill on a fixed clock. This
// runs from the background sweep (processNextDownloadJob), never inline
// in a request.
async function runFfmpegWatermark(sourceUrl: string, watermarkText: string): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "birq-watermark-"));
  const outputPath = join(workDir, "output.mp4");
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-i",
        sourceUrl,
        "-vf",
        `drawtext=fontfile=${env.FFMPEG_WATERMARK_FONT_PATH}:text='${watermarkText}':fontcolor=white@0.85:fontsize=28:x=w-tw-24:y=h-th-24:box=1:boxcolor=black@0.45:boxborderw=8`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ],
      { maxBuffer: 1024 * 1024 * 50 }
    );
    return await readFile(outputPath);
  } catch (err) {
    throw new Error(`Watermark render failed: ${err instanceof Error ? err.message : "unknown error"}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

type ContentType = "vod" | "clip";

// Self-download only (a creator downloading their own content) — matches
// the plan's "creator clicks Download VOD" — so ownership is checked
// once, here, at enqueue time; processNextDownloadJob below trusts a job
// already sitting in the queue and re-derives the source by content_id
// alone.
async function assertOwnedVod(vodId: string, userId: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM stream_vods v JOIN streams s ON s.id = v.stream_id WHERE v.id = $1 AND s.creator_id = $2`,
    [vodId, userId]
  );
  if (!rows[0]) throw new AppError(404, "VOD not found");
}

async function assertOwnedClip(clipId: string, userId: string): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM clips WHERE id = $1 AND creator_id = $2`, [clipId, userId]);
  if (!rows[0]) throw new AppError(404, "Clip not found");
}

export async function enqueueDownload(
  contentType: ContentType,
  contentId: string,
  userId: string
): Promise<{ jobId: string }> {
  if (contentType === "vod") {
    await assertOwnedVod(contentId, userId);
  } else {
    await assertOwnedClip(contentId, userId);
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO download_jobs (content_type, content_id, requested_by) VALUES ($1, $2, $3) RETURNING id`,
    [contentType, contentId, userId]
  );
  return { jobId: rows[0]!.id };
}

export async function getDownloadJobStatus(jobId: string, userId: string): Promise<DownloadJobStatus> {
  const { rows } = await pool.query<{
    status: DownloadJobStatus["status"];
    output_key: string | null;
    error_message: string | null;
  }>(`SELECT status, output_key, error_message FROM download_jobs WHERE id = $1 AND requested_by = $2`, [
    jobId,
    userId,
  ]);
  const row = rows[0];
  if (!row) throw new AppError(404, "Download job not found");
  return {
    status: row.status,
    downloadUrl: row.status === "done" && row.output_key ? await getSignedVodUrl(row.output_key) : null,
    errorMessage: row.error_message,
  };
}

async function resolveSourceObjectKey(contentType: ContentType, contentId: string): Promise<string | null> {
  if (contentType === "vod") {
    const { rows } = await pool.query<{ playback_url: string }>(
      `SELECT playback_url FROM stream_vods WHERE id = $1`,
      [contentId]
    );
    return rows[0]?.playback_url ?? null;
  }
  const { rows } = await pool.query<{ object_key: string }>(`SELECT object_key FROM clips WHERE id = $1`, [
    contentId,
  ]);
  return rows[0]?.object_key ?? null;
}

// Processes at most one job per sweep tick (server.ts) — a real
// multi-hour ffmpeg re-encode holding the process for a long stretch is
// exactly the kind of work this codebase deliberately keeps to "one at a
// time, polled" rather than firing an unbounded number of concurrent
// encodes (see admin/payout-batches-service.ts's own reasoning for a
// similar one-thing-at-a-time posture on a different kind of slow job).
// FOR UPDATE SKIP LOCKED means a second API instance's sweep can't double-
// claim the same pending row.
export async function processNextDownloadJob(): Promise<void> {
  const client = await pool.connect();
  let job: { id: string; content_type: ContentType; content_id: string; requested_by: string } | undefined;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      id: string;
      content_type: ContentType;
      content_id: string;
      requested_by: string;
    }>(
      `UPDATE download_jobs SET status = 'processing'
       WHERE id = (
         SELECT id FROM download_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING id, content_type, content_id, requested_by`
    );
    job = rows[0];
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  if (!job) return;

  try {
    const [objectKey, usernameRows] = await Promise.all([
      resolveSourceObjectKey(job.content_type, job.content_id),
      pool.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [job.requested_by]),
    ]);
    if (!objectKey) throw new Error(`${job.content_type} ${job.content_id} no longer exists`);
    const username = usernameRows.rows[0]?.username ?? "creator";

    const sourceUrl = await getSignedVodUrl(objectKey);
    const buffer = await runFfmpegWatermark(sourceUrl, `Birq.live / @${username}`);
    const outputKey = `downloads/${job.content_type}/${job.id}.mp4`;
    await uploadObject(outputKey, buffer, "video/mp4");

    await pool.query(
      `UPDATE download_jobs SET status = 'done', output_key = $2, completed_at = now() WHERE id = $1`,
      [job.id, outputKey]
    );
  } catch (err) {
    await pool.query(
      `UPDATE download_jobs SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1`,
      [job.id, err instanceof Error ? err.message : "unknown error"]
    );
  }
}
