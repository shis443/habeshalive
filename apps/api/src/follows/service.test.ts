import { afterAll, describe, expect, it } from "vitest";
import { AppError } from "../common/errors.js";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestCreator, createTestViewer } from "../test/fixtures.js";
import { getCreatorProfile, getFollowStatus, listMyFollowers, setFollowNotifyMode, toggleFollow } from "./service.js";

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
    expect(result!.socialLinks).toEqual({});
  });

  it("returns real social links once set", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    await pool.query(`UPDATE users SET social_links = $1 WHERE id = $2`, [
      JSON.stringify({ twitch: "https://twitch.tv/example", tiktok: "https://tiktok.com/@example" }),
      creator.id,
    ]);

    const result = await getCreatorProfile(creator.username, null);

    expect(result!.socialLinks).toEqual({
      twitch: "https://twitch.tv/example",
      tiktok: "https://tiktok.com/@example",
    });
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

describe("follow notify mode", () => {
  it("defaults a fresh follow to 'all'", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    await toggleFollow(viewer.id, creator.id);

    const status = await getFollowStatus(viewer.id, creator.id);
    expect(status.notifyMode).toBe("all");
  });

  it("round-trips setFollowNotifyMode through getFollowStatus", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    await toggleFollow(viewer.id, creator.id);

    await setFollowNotifyMode(viewer.id, creator.id, "muted");

    expect((await getFollowStatus(viewer.id, creator.id)).notifyMode).toBe("muted");
  });

  it("404s when setting notify mode for a creator the viewer doesn't follow", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    await expect(setFollowNotifyMode(viewer.id, creator.id, "muted")).rejects.toThrow(AppError);
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
