import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import {
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
} from "../test/fixtures.js";
import { getFollowedCreators, markFollowingSeen, toggleFollow } from "./service.js";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

beforeEach(async () => {
  // clear follows for a clean slate between tests
  await pool.query(`DELETE FROM follows`);
});

describe("getFollowedCreators feed", () => {
  it("includes currentStream only for live creators with real stream metadata and counts new content correctly", async () => {
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    const live = await createTestCreator();
    createdUserIds.push(live.id);
    // augment the live stream with predictable metadata
    await pool.query(`UPDATE streams SET thumbnail_url = $1, peak_viewers = $2, category = $3, language = $4 WHERE id = $5`, [
      'http://example.com/tn.jpg', 123, 'Gaming', 'en', live.streamId,
    ]);

    const offline = await createTestCreator();
    createdUserIds.push(offline.id);
    // mark their stream ended to simulate offline
    await pool.query(`UPDATE streams SET status = 'ended' WHERE id = $1`, [offline.streamId]);

    // viewer follows both
    await toggleFollow(viewer.id, live.id);
    await toggleFollow(viewer.id, offline.id);

    // set following_last_seen_at to 1 day ago so new content (now) counts
    await pool.query(`UPDATE users SET following_last_seen_at = now() - interval '1 day' WHERE id = $1`, [viewer.id]);

    // insert one VOD and one clip for the offline creator (should count)
    const { rows: vodRows } = await pool.query(`INSERT INTO stream_vods (stream_id, title, is_published, created_at) VALUES ($1, $2, true, now()) RETURNING id`, [
      (await pool.query(`SELECT id FROM streams WHERE creator_id = $1 ORDER BY created_at DESC LIMIT 1`, [offline.id])).rows[0].id,
      'New VOD',
    ]);
    await pool.query(`INSERT INTO clips (creator_id, title, created_at) VALUES ($1, $2, now())`, [offline.id, 'New Clip']);

    const creators = await getFollowedCreators(viewer.id);

    // find entries
    const liveRow = creators.find((c) => c.id === live.id)!;
    const offlineRow = creators.find((c) => c.id === offline.id)!;

    // currentStream present for live
    expect(liveRow.currentStream).not.toBeNull();
    expect(liveRow.currentStream!.title).toBeDefined();
    expect(liveRow.currentStream!.thumbnailUrl).toBe('http://example.com/tn.jpg');
    expect(liveRow.currentStream!.viewerCount).toBe(123);
    expect(liveRow.currentStream!.category).toBe('Gaming');
    expect(liveRow.currentStream!.language).toBe('en');
    expect(Array.isArray(liveRow.currentStream!.tags)).toBe(true);

    // offline has no currentStream
    expect(offlineRow.currentStream).toBeNull();

    // offline newContentCount should be 2 (one vod + one clip)
    expect(offlineRow.newContentCount).toBeGreaterThanOrEqual(2);
  });
});
