import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestUser } from "../test/fixtures.js";
import { blockCreator, getBlockStatus, unblockCreator } from "./service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("blockCreator / unblockCreator / getBlockStatus", () => {
  it("rejects blocking yourself", async () => {
    const user = await trackUser(await createTestViewer());
    await expect(blockCreator(user.id, user.id)).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);
  });

  it("is idempotent — blocking twice does not error or create a duplicate row", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());

    await blockCreator(viewer.id, creator.id);
    await blockCreator(viewer.id, creator.id);

    const { rows } = await pool.query(`SELECT count(*) FROM creator_blocks WHERE blocker_id = $1 AND creator_id = $2`, [
      viewer.id,
      creator.id,
    ]);
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it("getBlockStatus reflects the current state, and unblockCreator reverses it", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());

    expect(await getBlockStatus(viewer.id, creator.id)).toEqual({ blocked: false });

    await blockCreator(viewer.id, creator.id);
    expect(await getBlockStatus(viewer.id, creator.id)).toEqual({ blocked: true });

    await unblockCreator(viewer.id, creator.id);
    expect(await getBlockStatus(viewer.id, creator.id)).toEqual({ blocked: false });
  });
});
