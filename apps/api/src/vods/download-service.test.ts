import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestCreator, type TestCreator } from "../test/fixtures.js";

const execFileAsync = promisify(execFile);

// Same mocking posture as clip-service.test.ts: real object storage isn't
// configured in this test env, so uploadObject/getSignedVodUrl are mocked
// while the real ffmpeg watermark pipeline runs end to end against a real
// local HTTP server standing in for a signed source URL.
const uploadObjectMock = vi.fn(async (key: string, _body: Buffer, _contentType: string) => key);
let sourceServerUrl = "";
const SOURCE_KEY = "vods/test-creator/source.mp4";

vi.mock("../common/object-storage.js", () => ({
  getSignedVodUrl: async (key: string) => (key === SOURCE_KEY ? sourceServerUrl : `https://signed.example/${key}`),
  uploadObject: (...args: [string, Buffer, string]) => uploadObjectMock(...args),
}));

const { enqueueDownload, getDownloadJobStatus, processNextDownloadJob } = await import("./download-service.js");

const createdUserIds: string[] = [];
let httpServer: Server;
let workDir: string;

async function trackedCreator(): Promise<TestCreator> {
  const creator = await createTestCreator();
  createdUserIds.push(creator.id);
  return creator;
}

async function insertTestVod(streamId: string, playbackKey = SOURCE_KEY): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO stream_vods (stream_id, playback_url, expires_at)
     VALUES ($1, $2, now() + interval '7 days')
     RETURNING id`,
    [streamId, playbackKey]
  );
  return rows[0]!.id;
}

async function insertTestClip(vodId: string, creatorId: string, objectKey = SOURCE_KEY): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO clips (vod_id, creator_id, object_key, start_seconds, duration_seconds)
     VALUES ($1, $2, $3, 0, 5)
     RETURNING id`,
    [vodId, creatorId, objectKey]
  );
  return rows[0]!.id;
}

// Draining helper — the sweep claims and processes at most one row per
// call (see processNextDownloadJob's own "one job per tick" comment), so
// tests that seed exactly one job just await it once.

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "birq-download-test-"));
  const sourceVideoPath = join(workDir, "source.mp4");
  await execFileAsync("ffmpeg", [
    "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=3:r=10",
    "-f", "lavfi", "-i", "sine=f=1000:d=3",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-c:a", "aac",
    "-y", sourceVideoPath,
  ]);
  const videoBuffer = await readFile(sourceVideoPath);

  httpServer = createServer((req, res) => {
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": videoBuffer.length });
      res.end(videoBuffer);
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : videoBuffer.length - 1;
    res.writeHead(206, {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes ${start}-${end}/${videoBuffer.length}`,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
    });
    res.end(videoBuffer.subarray(start, end + 1));
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (address && typeof address === "object") {
    sourceServerUrl = `http://127.0.0.1:${address.port}/source.mp4`;
  }
}, 30_000);

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  await rm(workDir, { recursive: true, force: true });
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(async () => {
  uploadObjectMock.mockClear();
  // processNextDownloadJob claims the OLDEST pending row queue-wide
  // (ORDER BY created_at ASC) — a job left behind by an earlier test in
  // this file (several deliberately enqueue without ever processing, to
  // test enqueue/status alone) would otherwise get claimed ahead of a
  // later test's own job, making "the job I just enqueued" and "the job
  // the sweep just claimed" two different rows. This file owns the whole
  // download_jobs table for the duration of the run (fileParallelism is
  // off, and no other suite touches this table yet), so clearing it after
  // every test is safe and keeps each test's queue state self-contained.
  await pool.query(`DELETE FROM download_jobs`);
});

describe("enqueueDownload", () => {
  it("rejects enqueueing a VOD download you don't own", async () => {
    const owner = await trackedCreator();
    const stranger = await trackedCreator();
    const vodId = await insertTestVod(owner.streamId);

    await expect(enqueueDownload("vod", vodId, stranger.id)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it("rejects enqueueing a clip download you don't own", async () => {
    const owner = await trackedCreator();
    const stranger = await trackedCreator();
    const vodId = await insertTestVod(owner.streamId);
    const clipId = await insertTestClip(vodId, owner.id);

    await expect(enqueueDownload("clip", clipId, stranger.id)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it("404s enqueueing a nonexistent VOD", async () => {
    const creator = await trackedCreator();
    await expect(
      enqueueDownload("vod", "00000000-0000-0000-0000-000000000000", creator.id)
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("getDownloadJobStatus", () => {
  it("404s for a job that isn't yours", async () => {
    const owner = await trackedCreator();
    const stranger = await trackedCreator();
    const vodId = await insertTestVod(owner.streamId);
    const { jobId } = await enqueueDownload("vod", vodId, owner.id);

    await expect(getDownloadJobStatus(jobId, stranger.id)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it("404s for a nonexistent job", async () => {
    const creator = await trackedCreator();
    await expect(
      getDownloadJobStatus("00000000-0000-0000-0000-000000000000", creator.id)
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("processNextDownloadJob", () => {
  it("burns in a real watermark and moves a VOD job pending -> done", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId);
    const { jobId } = await enqueueDownload("vod", vodId, creator.id);

    const pending = await getDownloadJobStatus(jobId, creator.id);
    expect(pending).toEqual({ status: "pending", downloadUrl: null, errorMessage: null });

    await processNextDownloadJob();

    const done = await getDownloadJobStatus(jobId, creator.id);
    expect(done.status).toBe("done");
    expect(done.errorMessage).toBeNull();
    expect(done.downloadUrl).toBe(`https://signed.example/downloads/vod/${jobId}.mp4`);

    expect(uploadObjectMock).toHaveBeenCalledTimes(1);
    const [key, buffer, contentType] = uploadObjectMock.mock.calls[0]!;
    expect(key).toBe(`downloads/vod/${jobId}.mp4`);
    expect(contentType).toBe("video/mp4");
    // Real MP4 container produced by ffmpeg, not an empty/corrupt file —
    // same "ftyp" box sanity check as clip-service.test.ts's createClip
    // assertion.
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 12).toString("latin1")).toContain("ftyp");
  }, 30_000);

  it("burns in a real watermark and moves a clip job pending -> done", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId);
    const clipId = await insertTestClip(vodId, creator.id);
    const { jobId } = await enqueueDownload("clip", clipId, creator.id);

    await processNextDownloadJob();

    const done = await getDownloadJobStatus(jobId, creator.id);
    expect(done.status).toBe("done");
    expect(uploadObjectMock).toHaveBeenCalledTimes(1);
    expect(uploadObjectMock.mock.calls[0]![0]).toBe(`downloads/clip/${jobId}.mp4`);
  }, 30_000);

  it("marks a job failed when the source content no longer exists", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId);
    const { jobId } = await enqueueDownload("vod", vodId, creator.id);
    await pool.query(`DELETE FROM stream_vods WHERE id = $1`, [vodId]);

    await processNextDownloadJob();

    const failed = await getDownloadJobStatus(jobId, creator.id);
    expect(failed.status).toBe("failed");
    expect(failed.downloadUrl).toBeNull();
    expect(failed.errorMessage).toMatch(/no longer exists/);
    expect(uploadObjectMock).not.toHaveBeenCalled();
  }, 30_000);

  it("is a no-op when the queue is empty", async () => {
    await expect(processNextDownloadJob()).resolves.toBeUndefined();
  });
});
