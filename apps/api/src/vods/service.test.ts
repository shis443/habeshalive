import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestCreator } from "../test/fixtures.js";
import { deleteVodOwned, incrementVodViews, listMyVods, listVodsForCreator, publishVod, unpublishVod } from "./service.js";

const createdUserIds: string[] = [];

async function trackedCreator(): Promise<TestCreator> {
  const creator = await createTestCreator();
  createdUserIds.push(creator.id);
  return creator;
}

// Bypasses createVodFromRecording (which needs real object-storage
// credentials to actually PUT — see docs/vod-recording-rollout.md) since
// none of this file's tests are about the recording pipeline itself, only
// what happens to a row once it exists. published defaults to false,
// matching the real migration default (db/migrations/0028_vod_publish_
// workflow.sql) rather than re-asserting it as a magic value here.
async function insertTestVod(
  streamId: string,
  overrides: { isPublished?: boolean; title?: string | null } = {}
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO stream_vods (stream_id, playback_url, expires_at, is_published, title)
     VALUES ($1, $2, now() + interval '7 days', $3, $4)
     RETURNING id`,
    [streamId, `${streamId}/test.mp4`, overrides.isPublished ?? false, overrides.title ?? null]
  );
  return rows[0]!.id;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("listVodsForCreator (public path)", () => {
  it("only returns published VODs, never drafts", async () => {
    const creator = await trackedCreator();
    await insertTestVod(creator.streamId, { isPublished: false, title: "Draft" });
    const publishedId = await insertTestVod(creator.streamId, { isPublished: true, title: "Live cut" });

    const result = await listVodsForCreator(creator.username);

    expect(result.map((v) => v.id)).toEqual([publishedId]);
    expect(result[0]!.title).toBe("Live cut");
    expect(result[0]!.isPublished).toBe(true);
  });

  it("falls back to the parent stream's title when no per-VOD override is set", async () => {
    const creator = await trackedCreator();
    await insertTestVod(creator.streamId, { isPublished: true, title: null });

    const result = await listVodsForCreator(creator.username);

    expect(result[0]!.title).toBe("Test Stream"); // createTestCreator's fixed stream title
  });
});

describe("listMyVods (authenticated, owner-only)", () => {
  it("returns both published and draft VODs for the owning creator", async () => {
    const creator = await trackedCreator();
    const draftId = await insertTestVod(creator.streamId, { isPublished: false });
    const publishedId = await insertTestVod(creator.streamId, { isPublished: true });

    const result = await listMyVods(creator.id);

    expect(new Set(result.map((v) => v.id))).toEqual(new Set([draftId, publishedId]));
  });

  it("returns nothing for a user with no streams", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    const result = await listMyVods(viewer.id);

    expect(result).toEqual([]);
  });
});

describe("publishVod", () => {
  it("publishes a draft and applies title/description/category overrides", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId, { isPublished: false });

    const result = await publishVod(vodId, creator.id, {
      title: "Full playthrough — part 3",
      description: "Chapter 3 of the series.",
      category: "Gaming",
    });

    expect(result.isPublished).toBe(true);
    expect(result.title).toBe("Full playthrough — part 3");
    expect(result.description).toBe("Chapter 3 of the series.");
    expect(result.category).toBe("Gaming");

    // Also actually visible on the public path now, not just returned by
    // this call — the real thing this whole feature is for.
    const publicList = await listVodsForCreator(creator.username);
    expect(publicList.map((v) => v.id)).toContain(vodId);
  });

  it("rejects publishing someone else's VOD", async () => {
    const owner = await trackedCreator();
    const attacker = await trackedCreator();
    const vodId = await insertTestVod(owner.streamId, { isPublished: false });

    await expect(publishVod(vodId, attacker.id, {})).rejects.toThrow(AppError);
    await expect(publishVod(vodId, attacker.id, {})).rejects.toMatchObject({ statusCode: 404 });

    // Confirms the rejected call didn't mutate anything — not just that it
    // threw, but that the draft is still a draft.
    const stillDraft = await listVodsForCreator(owner.username);
    expect(stillDraft).toEqual([]);
  });

  it("404s for a nonexistent VOD id", async () => {
    const creator = await trackedCreator();
    await expect(publishVod("00000000-0000-4000-8000-000000000000", creator.id, {})).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("unpublishVod", () => {
  it("takes a published VOD back off the public path", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId, { isPublished: true });

    await unpublishVod(vodId, creator.id);

    const publicList = await listVodsForCreator(creator.username);
    expect(publicList).toEqual([]);
    const mine = await listMyVods(creator.id);
    expect(mine.find((v) => v.id === vodId)?.isPublished).toBe(false);
  });

  it("rejects unpublishing someone else's VOD", async () => {
    const owner = await trackedCreator();
    const attacker = await trackedCreator();
    const vodId = await insertTestVod(owner.streamId, { isPublished: true });

    await expect(unpublishVod(vodId, attacker.id)).rejects.toMatchObject({ statusCode: 404 });
    const publicList = await listVodsForCreator(owner.username);
    expect(publicList.map((v) => v.id)).toContain(vodId); // untouched
  });
});

describe("deleteVodOwned", () => {
  it("removes the VOD row for its owner", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId, { isPublished: true });

    await deleteVodOwned(vodId, creator.id);

    const { rows } = await pool.query(`SELECT id FROM stream_vods WHERE id = $1`, [vodId]);
    expect(rows).toEqual([]);
  });

  it("rejects deleting someone else's VOD, and leaves it in place", async () => {
    const owner = await trackedCreator();
    const attacker = await trackedCreator();
    const vodId = await insertTestVod(owner.streamId, { isPublished: true });

    await expect(deleteVodOwned(vodId, attacker.id)).rejects.toMatchObject({ statusCode: 404 });

    const { rows } = await pool.query(`SELECT id FROM stream_vods WHERE id = $1`, [vodId]);
    expect(rows).toHaveLength(1);
  });
});

describe("incrementVodViews", () => {
  it("increments views on a published VOD", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId, { isPublished: true });

    await incrementVodViews(vodId);
    await incrementVodViews(vodId);

    const { rows } = await pool.query<{ views: number }>(`SELECT views FROM stream_vods WHERE id = $1`, [vodId]);
    expect(rows[0]!.views).toBe(2);
  });

  it("does not increment views on an unpublished draft", async () => {
    const creator = await trackedCreator();
    const vodId = await insertTestVod(creator.streamId, { isPublished: false });

    await incrementVodViews(vodId);

    const { rows } = await pool.query<{ views: number }>(`SELECT views FROM stream_vods WHERE id = $1`, [vodId]);
    expect(rows[0]!.views).toBe(0);
  });
});
