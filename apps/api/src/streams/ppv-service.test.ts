import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import {
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getWalletBalance,
  type TestCreator,
  type TestUser,
} from "../test/fixtures.js";
import { completeTopupFromWebhook, initiateTopup } from "../wallet/service.js";
import { hasPpvAccess, purchasePpvAccess } from "./ppv-service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function fundWallet(userId: string, amountSantim: number): Promise<void> {
  const { reference } = await initiateTopup(userId, amountSantim);
  await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: amountSantim, currency: "ETB" });
}

async function makePpvStream(revenueShareBps = 8000): Promise<TestCreator & { priceSantim: number }> {
  const creator = await trackUser(await createTestCreator(revenueShareBps));
  const priceSantim = 5000;
  await pool.query(`UPDATE streams SET is_ppv = true, ppv_price_santim = $1 WHERE id = $2`, [
    priceSantim,
    creator.streamId,
  ]);
  return { ...creator, priceSantim };
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("purchasePpvAccess", () => {
  it("charges the buyer, splits revenue by revenue_share_bps, and records the purchase", async () => {
    const creator = await makePpvStream(8000);
    const buyer = await trackUser(await createTestViewer());
    await fundWallet(buyer.id, 10_000);

    await purchasePpvAccess(buyer.id, creator.streamId);

    expect(await getWalletBalance(buyer.walletId)).toBe(5_000); // 10,000 - 5,000 price
    expect(await getWalletBalance(creator.walletId)).toBe(4_000); // 80% of 5,000
    expect(await hasPpvAccess(creator.streamId, buyer.id)).toBe(true);
  });

  it("rejects a purchase when the buyer's balance is insufficient, no partial charge", async () => {
    const creator = await makePpvStream();
    const buyer = await trackUser(await createTestViewer());
    await fundWallet(buyer.id, 1_000);

    await expect(purchasePpvAccess(buyer.id, creator.streamId)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
    expect(await getWalletBalance(buyer.walletId)).toBe(1_000);
    expect(await hasPpvAccess(creator.streamId, buyer.id)).toBe(false);
  });

  it("rejects buying access to a non-PPV stream", async () => {
    const creator = await trackUser(await createTestCreator());
    const buyer = await trackUser(await createTestViewer());
    await fundWallet(buyer.id, 10_000);

    await expect(purchasePpvAccess(buyer.id, creator.streamId)).rejects.toThrow(/isn't pay-per-view/);
  });

  it("rejects the creator buying access to their own stream", async () => {
    const creator = await makePpvStream();
    await expect(purchasePpvAccess(creator.id, creator.streamId)).rejects.toThrow(/own stream/);
  });

  it("a second purchase for the same (stream, buyer) is a free no-op, not a double charge", async () => {
    const creator = await makePpvStream();
    const buyer = await trackUser(await createTestViewer());
    await fundWallet(buyer.id, 10_000);

    await purchasePpvAccess(buyer.id, creator.streamId);
    expect(await getWalletBalance(buyer.walletId)).toBe(5_000);

    await purchasePpvAccess(buyer.id, creator.streamId);
    expect(await getWalletBalance(buyer.walletId)).toBe(5_000); // unchanged — no second charge
  });
});

describe("hasPpvAccess", () => {
  it("is false for an undefined viewer (anonymous)", async () => {
    const creator = await makePpvStream();
    expect(await hasPpvAccess(creator.streamId, undefined)).toBe(false);
  });

  it("is false for a stream the viewer hasn't purchased", async () => {
    const creator = await makePpvStream();
    const viewer = await trackUser(await createTestViewer());
    expect(await hasPpvAccess(creator.streamId, viewer.id)).toBe(false);
  });
});
