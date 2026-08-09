import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestViewer, type TestUser } from "../test/fixtures.js";
import {
  blockViewerFromChannel,
  grantChannelModerator,
  isBlockedFromChannel,
  isChannelModerator,
  listChannelBlocks,
  listChannelModerators,
  listChannelsIModerate,
  revokeChannelModerator,
  unblockViewerFromChannel,
} from "./channel-mods-service.js";

const createdUserIds: string[] = [];

async function trackedViewer(): Promise<TestUser> {
  const viewer = await createTestViewer();
  createdUserIds.push(viewer.id);
  return viewer;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("grantChannelModerator / revokeChannelModerator", () => {
  it("lets the channel owner grant and revoke moderator status", async () => {
    const creator = await trackedViewer();
    const mod = await trackedViewer();

    const granted = await grantChannelModerator(creator.id, creator.id, mod.username);
    expect(granted.userId).toBe(mod.id);
    expect(await isChannelModerator(creator.id, mod.id)).toBe(true);

    await revokeChannelModerator(creator.id, creator.id, mod.id);
    expect(await isChannelModerator(creator.id, mod.id)).toBe(false);
  });

  it("rejects a non-owner granting moderator status, including an already-granted moderator", async () => {
    const creator = await trackedViewer();
    const mod = await trackedViewer();
    const stranger = await trackedViewer();
    await grantChannelModerator(creator.id, creator.id, mod.username);

    await expect(grantChannelModerator(creator.id, stranger.id, mod.username)).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
    // A granted moderator still can't grant others — anti-privilege-
    // escalation, see channel-mods-service.ts's assertIsChannelOwner.
    await expect(grantChannelModerator(creator.id, mod.id, stranger.username)).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  it("rejects granting yourself moderator status on your own channel", async () => {
    const creator = await trackedViewer();
    await expect(grantChannelModerator(creator.id, creator.id, creator.username)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("404s for an unknown username", async () => {
    const creator = await trackedViewer();
    await expect(grantChannelModerator(creator.id, creator.id, "no_such_user_xyz")).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it("is idempotent — granting the same moderator twice doesn't error", async () => {
    const creator = await trackedViewer();
    const mod = await trackedViewer();
    await grantChannelModerator(creator.id, creator.id, mod.username);
    await expect(grantChannelModerator(creator.id, creator.id, mod.username)).resolves.toMatchObject({
      userId: mod.id,
    });
  });

  it("404s revoking someone who isn't a moderator", async () => {
    const creator = await trackedViewer();
    const notMod = await trackedViewer();
    await expect(revokeChannelModerator(creator.id, creator.id, notMod.id)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });
});

describe("listChannelModerators", () => {
  it("is visible to the owner, a granted moderator, and platform staff — not a random viewer", async () => {
    const creator = await trackedViewer();
    const mod = await trackedViewer();
    const stranger = await trackedViewer();
    await grantChannelModerator(creator.id, creator.id, mod.username);

    await expect(listChannelModerators(creator.id, creator.id)).resolves.toHaveLength(1);
    await expect(listChannelModerators(creator.id, mod.id)).resolves.toHaveLength(1);
    await expect(listChannelModerators(creator.id, stranger.id)).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
  });
});

describe("listChannelsIModerate", () => {
  it("lists channels that granted me moderator status, newest first, and is my-own — no access gate", async () => {
    const mod = await trackedViewer();
    expect(await listChannelsIModerate(mod.id)).toEqual([]);

    const firstCreator = await trackedViewer();
    const secondCreator = await trackedViewer();
    await grantChannelModerator(firstCreator.id, firstCreator.id, mod.username);
    await grantChannelModerator(secondCreator.id, secondCreator.id, mod.username);

    const channels = await listChannelsIModerate(mod.id);
    expect(channels.map((c) => c.creatorId)).toEqual([secondCreator.id, firstCreator.id]);
    expect(channels[0]).toMatchObject({ creatorUsername: secondCreator.username });
  });
});

describe("blockViewerFromChannel / unblockViewerFromChannel", () => {
  it("lets the owner block and unblock a viewer", async () => {
    const creator = await trackedViewer();
    const viewer = await trackedViewer();

    const block = await blockViewerFromChannel(creator.id, creator.id, viewer.username);
    expect(block.userId).toBe(viewer.id);
    expect(await isBlockedFromChannel(creator.id, viewer.id)).toBe(true);

    await unblockViewerFromChannel(creator.id, creator.id, viewer.id);
    expect(await isBlockedFromChannel(creator.id, viewer.id)).toBe(false);
  });

  it("lets a granted channel moderator block a viewer, but not a random viewer", async () => {
    const creator = await trackedViewer();
    const mod = await trackedViewer();
    const target = await trackedViewer();
    const stranger = await trackedViewer();
    await grantChannelModerator(creator.id, creator.id, mod.username);

    await blockViewerFromChannel(creator.id, mod.id, target.username);
    expect(await isBlockedFromChannel(creator.id, target.id)).toBe(true);

    await expect(blockViewerFromChannel(creator.id, stranger.id, target.username)).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  it("rejects blocking yourself from your own channel", async () => {
    const creator = await trackedViewer();
    await expect(blockViewerFromChannel(creator.id, creator.id, creator.username)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("404s unblocking someone who isn't blocked", async () => {
    const creator = await trackedViewer();
    const viewer = await trackedViewer();
    await expect(unblockViewerFromChannel(creator.id, creator.id, viewer.id)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });
});

describe("listChannelBlocks", () => {
  it("newest first, and only reachable by the owner/moderator/staff", async () => {
    const creator = await trackedViewer();
    const first = await trackedViewer();
    const second = await trackedViewer();
    const stranger = await trackedViewer();
    await blockViewerFromChannel(creator.id, creator.id, first.username);
    await blockViewerFromChannel(creator.id, creator.id, second.username);

    const list = await listChannelBlocks(creator.id, creator.id);
    expect(list.map((b) => b.userId)).toEqual([second.id, first.id]);

    await expect(listChannelBlocks(creator.id, stranger.id)).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
  });
});
