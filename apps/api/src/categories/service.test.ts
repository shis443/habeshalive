import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestCreator } from "../test/fixtures.js";
import { getCategoryBySlug, listCategories } from "./service.js";

const createdUserIds: string[] = [];
const createdStreamIds: string[] = [];

afterAll(async () => {
  if (createdStreamIds.length > 0) {
    await pool.query(`DELETE FROM streams WHERE id = ANY($1::uuid[])`, [createdStreamIds]);
  }
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

async function createLiveStreamInCategory(creatorId: string, category: string, peakViewers: number): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, category, playback_url, status, started_at, peak_viewers)
     VALUES ($1, 'Test Stream', $2, 'https://video.example.com/stream.m3u8', 'live', now(), $3)
     RETURNING id`,
    [creatorId, category, peakViewers]
  );
  createdStreamIds.push(rows[0]!.id);
}

// migration 0046 seeds the real 4 categories this test relies on existing
// (Music/Gaming/Traditional/Just Chatting) — not fixture data this test
// creates itself, since the catalog is meant to be a fixed, seeded set.
describe("listCategories", () => {
  it("returns the seeded categories with real tags", async () => {
    const categories = await listCategories();
    expect(categories.length).toBeGreaterThanOrEqual(4);
    const music = categories.find((c) => c.slug === "Music");
    expect(music).toBeDefined();
    expect(music!.name).toBe("Music");
    expect(music!.tags.length).toBeGreaterThan(0);
  });

  it("reflects a real live viewer count from an actual live stream, not a placeholder", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    await createLiveStreamInCategory(creator.id, "Gaming", 42);

    const categories = await listCategories();
    const gaming = categories.find((c) => c.slug === "Gaming");
    expect(gaming!.liveViewerCount).toBeGreaterThanOrEqual(42);
    expect(gaming!.liveChannelCount).toBeGreaterThanOrEqual(1);
  });
});

describe("getCategoryBySlug", () => {
  it("returns null for a slug that doesn't exist", async () => {
    const result = await getCategoryBySlug("definitely-not-a-real-category-xyz");
    expect(result).toBeNull();
  });

  it("returns the real category with description and tags", async () => {
    const result = await getCategoryBySlug("Just Chatting");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Just Chatting");
    expect(result!.description).toBeTruthy();
    expect(result!.tags).toContain("Talk Show");
  });
});
