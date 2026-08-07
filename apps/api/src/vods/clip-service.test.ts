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

// Real object storage isn't configured in this test env (VOD_S3_* unset —
// see .env.example) — mocked here (this file's first use of vi.mock,
// same reasoning as kyc/service.test.ts's) so createClip's real ffmpeg
// logic can still be exercised end to end: getSignedVodUrl is asked
// twice per clip (once for the *source* VOD, once for the *output*
// clip's own object_key) and needs to answer differently for each —
// see SOURCE_KEY below.
const uploadObjectMock = vi.fn(async (key: string, _body: Buffer, _contentType: string) => key);
let sourceServerUrl = "";
const SOURCE_KEY = "vods/test-creator/source.mp4";

vi.mock("../common/object-storage.js", () => ({
  isObjectStorageConfigured: true,
  uploadObject: (...args: [string, Buffer, string]) => uploadObjectMock(...args),
  getSignedVodUrl: async (key: string) => (key === SOURCE_KEY ? sourceServerUrl : `https://signed.example/${key}`),
  deleteObject: vi.fn(async () => {}),
}));

const { createClip, deleteClipOwned, listClipsForCreator } = await import("./clip-service.js");
const { deleteObject } = await import("../common/object-storage.js");

const createdUserIds: string[] = [];
let httpServer: Server;
let sourceVideoPath: string;
let workDir: string;

async function trackedCreator(): Promise<TestCreator> {
  const creator = await createTestCreator();
  createdUserIds.push(creator.id);
  return creator;
}

async function insertTestVod(streamId: string, durationSeconds = 10): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO stream_vods (stream_id, playback_url, expires_at, duration_seconds)
     VALUES ($1, $2, now() + interval '7 days', $3)
     RETURNING id`,
    [streamId, SOURCE_KEY, durationSeconds]
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "birq-clip-test-"));
  sourceVideoPath = join(workDir, "source.mp4");
  // A real, short synthetic video (solid color + tone) — genuinely
  // decodable by ffmpeg, not a fake/empty file, so createClip's crop+
  // scale filter chain runs against real video data.
  await execFileAsync("ffmpeg", [
    "-f", "lavfi", "-i", "color=c=blue:s=1280x720:d=10:r=15",
    "-f", "lavfi", "-i", "sine=f=1000:d=10",
    "-c:v", "libx264", "-preset", "ultrafast",
    "-c:a", "aac",
    "-y", sourceVideoPath,
  ]);
  const videoBuffer = await readFile(sourceVideoPath);

  // Must support byte-range requests (206 Partial Content) — ffmpeg's
  // -ss placed before a remote -i does a fast seek via HTTP Range
  // requests rather than downloading and decoding from the start. A
  // real S3/R2 signed URL always supports Range; a naive server that
  // ignores the header and always returns the full file with 200
  // breaks that seek (confirmed live: this exact gap produced a real
  // "partial file" / "Invalid data found" ffmpeg failure the first
  // time this test ran against a Range-less server).
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

afterEach(() => {
  uploadObjectMock.mockClear();
});

describe("createClip", () => {
  it("crops and scales a real clip to 1080x1920 and uploads it", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId);

    const clip = await createClip(creator.id, vodId, { startSeconds: 1, durationSeconds: 3 });

    expect(clip.vodId).toBe(vodId);
    expect(clip.startSeconds).toBe(1);
    expect(clip.durationSeconds).toBe(3);
    expect(uploadObjectMock).toHaveBeenCalledTimes(1);

    const [key, buffer, contentType] = uploadObjectMock.mock.calls[0]!;
    expect(key).toMatch(new RegExp(`^clips/${creator.id}/.+\\.mp4$`));
    expect(contentType).toBe("video/mp4");
    // Real MP4 files carry an "ftyp" box near the start — a cheap,
    // real sanity check that ffmpeg actually produced a valid
    // container, not an empty or corrupt file.
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 12).toString("latin1")).toContain("ftyp");

    // Verify the actual output dimensions via ffprobe — real proof the
    // crop=ih*9/16:ih,scale=1080:1920 filter chain did what it claims,
    // not just "ffmpeg exited 0".
    const probeDir = await mkdtemp(join(tmpdir(), "birq-clip-probe-"));
    const probePath = join(probeDir, "out.mp4");
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(probePath, buffer);
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0",
        probePath,
      ]);
      expect(stdout.trim()).toBe("1080,1920");
    } finally {
      await rm(probeDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects a clip range extending past the VOD's duration", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId, 10);

    await expect(createClip(creator.id, vodId, { startSeconds: 8, durationSeconds: 5 })).rejects.toThrow(
      /extends past/
    );
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("rejects clipping a VOD you don't own", async () => {
    const owner = await trackedCreator();
    const stranger = await trackedCreator();
    const vodId = await insertTestVod(owner.streamId);

    await expect(createClip(stranger.id, vodId, { startSeconds: 0, durationSeconds: 3 })).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it("404s for a nonexistent VOD", async () => {
    const creator = await trackedCreator();
    await expect(
      createClip(creator.id, "00000000-0000-0000-0000-000000000000", { startSeconds: 0, durationSeconds: 3 })
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("listClipsForCreator / deleteClipOwned", () => {
  it("lists a creator's clips newest first and deletes cleanly", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId);

    const first = await createClip(creator.id, vodId, { startSeconds: 0, durationSeconds: 2, title: "First" });
    const second = await createClip(creator.id, vodId, { startSeconds: 2, durationSeconds: 2, title: "Second" });

    const list = await listClipsForCreator(creator.username);
    expect(list.map((c) => c.id)).toEqual([second.id, first.id]);

    await deleteClipOwned(first.id, creator.id);
    expect(deleteObject).toHaveBeenCalledWith(expect.stringContaining(`clips/${creator.id}/`));

    const afterDelete = await listClipsForCreator(creator.username);
    expect(afterDelete.map((c) => c.id)).toEqual([second.id]);
  }, 30_000);

  it("rejects deleting a clip you don't own", async () => {
    const owner = await trackedCreator();
    const stranger = await trackedCreator();
    const vodId = await insertTestVod(owner.streamId);
    const clip = await createClip(owner.id, vodId, { startSeconds: 0, durationSeconds: 2 });

    await expect(deleteClipOwned(clip.id, stranger.id)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  }, 30_000);
});
