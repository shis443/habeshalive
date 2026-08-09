import { DAILY_POINT_CAP, POINTS_PER_HEARTBEAT, POINTS_PER_SANTIM } from "@birq/shared";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import {
  assertTransactionBalanced,
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getWalletBalance,
  type TestCreator,
  type TestUser,
} from "../test/fixtures.js";
import { getPointsBalance, recordWatchHeartbeat, redeemPoints } from "./service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("recordWatchHeartbeat", () => {
  it("is 0 for a user who's never earned any", async () => {
    const viewer = await trackUser(await createTestViewer());
    expect(await getPointsBalance(viewer.id)).toBe(0);
  });

  it("rejects a heartbeat for a stream that isn't live", async () => {
    const creator: TestCreator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());
    await pool.query(`UPDATE streams SET status = 'ended' WHERE id = $1`, [creator.streamId]);

    await expect(recordWatchHeartbeat(viewer.id, creator.streamId)).rejects.toThrow(/isn't live/);
    expect(await getPointsBalance(viewer.id)).toBe(0);
  });

  it("awards POINTS_PER_HEARTBEAT and updates the running balance", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());

    const result = await recordWatchHeartbeat(viewer.id, creator.streamId);
    expect(result.awarded).toBe(POINTS_PER_HEARTBEAT);
    expect(result.balance).toBe(POINTS_PER_HEARTBEAT);
    expect(result.dailyCapReached).toBe(false);
    expect(await getPointsBalance(viewer.id)).toBe(POINTS_PER_HEARTBEAT);

    const second = await recordWatchHeartbeat(viewer.id, creator.streamId);
    expect(second.balance).toBe(POINTS_PER_HEARTBEAT * 2);
  });

  it("caps awards at DAILY_POINT_CAP and reports dailyCapReached", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());

    const heartbeats = Math.ceil(DAILY_POINT_CAP / POINTS_PER_HEARTBEAT) + 2;
    let last;
    for (let i = 0; i < heartbeats; i++) {
      last = await recordWatchHeartbeat(viewer.id, creator.streamId);
    }

    expect(last!.balance).toBe(DAILY_POINT_CAP);
    expect(last!.dailyCapReached).toBe(true);
    expect(last!.awarded).toBe(0); // already at the cap by the last call
    expect(await getPointsBalance(viewer.id)).toBe(DAILY_POINT_CAP);
  });

  it("tracks separate viewers independently", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewerA = await trackUser(await createTestViewer());
    const viewerB = await trackUser(await createTestViewer());

    await recordWatchHeartbeat(viewerA.id, creator.streamId);
    expect(await getPointsBalance(viewerA.id)).toBe(POINTS_PER_HEARTBEAT);
    expect(await getPointsBalance(viewerB.id)).toBe(0);
  });
});

describe("redeemPoints", () => {
  it("credits real wallet balance at POINTS_PER_SANTIM, debits the platform wallet, ledger balanced", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());
    for (let i = 0; i < 5; i++) await recordWatchHeartbeat(viewer.id, creator.streamId);
    const earned = await getPointsBalance(viewer.id);

    const redeemAmount = POINTS_PER_SANTIM * 3;
    const result = await redeemPoints(viewer.id, redeemAmount);

    expect(result.creditedSantim).toBe(3);
    expect(result.balance).toBe(earned - redeemAmount);
    expect(await getPointsBalance(viewer.id)).toBe(earned - redeemAmount);
    expect(await getWalletBalance(viewer.walletId)).toBe(3);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT lt.id FROM ledger_transactions lt
       JOIN ledger_entries le ON le.ledger_transaction_id = lt.id
       WHERE lt.type = 'points_redemption' AND le.wallet_id = $1`,
      [viewer.walletId]
    );
    await assertTransactionBalanced(rows[0]!.id);
  });

  it("rejects redeeming more points than the balance holds", async () => {
    const viewer = await trackUser(await createTestViewer());
    await expect(redeemPoints(viewer.id, POINTS_PER_SANTIM)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("rejects redeeming fewer points than POINTS_PER_SANTIM (would round to 0 santim)", async () => {
    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());
    await recordWatchHeartbeat(viewer.id, creator.streamId);

    await expect(redeemPoints(viewer.id, POINTS_PER_SANTIM - 1)).rejects.toThrow(/Redeem at least/);
  });

  it("leaves the balance untouched after a rejected redemption", async () => {
    const viewer = await trackUser(await createTestViewer());
    await expect(redeemPoints(viewer.id, 1_000_000)).rejects.toThrow();
    expect(await getPointsBalance(viewer.id)).toBe(0);
  });
});
