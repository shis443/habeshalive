import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestCreator, createTestViewer } from "../test/fixtures.js";
import { getCreatorProfile, listMyFollowers, toggleFollow } from "./service.js";

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("getCreatorProfile", () => {
  it("returns null for a username that doesn't exist", async () => {
    const result = await getCreatorProfile("definitely-not-a-real-username-xyz", null);
    expect(result).toBeNull();
  });

  it("returns real profile fields, independent of live status", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    const result = await getCreatorProfile(creator.username, null);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(creator.id);
    expect(result!.username).toBe(creator.username);
    expect(result!.followerCount).toBe(0);
    expect(result!.isFollowing).toBe(false);
  });

  it("reflects a real follow relationship and follower count", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    await toggleFollow(viewer.id, creator.id);

    const asFollower = await getCreatorProfile(creator.username, viewer.id);
    expect(asFollower!.isFollowing).toBe(true);
    expect(asFollower!.followerCount).toBe(1);

    const asAnonymous = await getCreatorProfile(creator.username, null);
    expect(asAnonymous!.isFollowing).toBe(false); // personalization only, count is still public
    expect(asAnonymous!.followerCount).toBe(1);
  });
});

describe("listMyFollowers", () => {
  it("lists real followers newest first, and is empty with none", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    expect(await listMyFollowers(creator.id)).toEqual([]);

    const first = await createTestViewer();
    createdUserIds.push(first.id);
    const second = await createTestViewer();
    createdUserIds.push(second.id);
    await toggleFollow(first.id, creator.id);
    await toggleFollow(second.id, creator.id);

    const followers = await listMyFollowers(creator.id);
    expect(followers.map((f) => f.userId)).toEqual([second.id, first.id]);
    expect(followers[0]).toMatchObject({ username: second.username });
  });
});
