import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { completeTopupFromWebhook, initiateTopup } from "../wallet/service.js";
import { boostStream } from "../streams/service.js";
import { getBoostPricing } from "./config-service.js";
import {
  assertTransactionBalanced,
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getWalletBalance,
  type TestUser,
} from "../test/fixtures.js";
import { cancelBoost } from "./boosts-service.js";

const createdUserIds: string[] = [];

async function fundWallet(userId: string, amountSantim: number): Promise<void> {
  const { reference } = await initiateTopup(userId, amountSantim);
  await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: amountSantim, currency: "ETB" });
}

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function getPlatformWalletId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM wallets WHERE owner_type = 'platform' AND currency = 'ETB' LIMIT 1`
  );
  return rows[0]!.id;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("boostStream", () => {
  it("charges the creator 100% to the platform (no revenue split) for a live stream", async () => {
    const { priceSantim } = await getBoostPricing();
    const creator = await trackUser(await createTestCreator());
    await fundWallet(creator.id, priceSantim + 10_000);
    const platformWalletId = await getPlatformWalletId();
    const platformBefore = await getWalletBalance(platformWalletId);

    const boost = await boostStream(creator.id);

    expect(await getWalletBalance(creator.walletId)).toBe(10_000);
    expect(await getWalletBalance(platformWalletId)).toBe(platformBefore + priceSantim);
    expect(new Date(boost.endsAt).getTime()).toBeGreaterThan(Date.now());

    const { rows } = await pool.query<{ ledger_transaction_id: string }>(
      `SELECT ledger_transaction_id FROM stream_boosts WHERE id = $1`,
      [boost.id]
    );
    await assertTransactionBalanced(rows[0]!.ledger_transaction_id);
  });

  it("rejects boosting when the creator isn't live", async () => {
    const viewer = await trackUser(await createTestViewer());
    await expect(boostStream(viewer.id)).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);
  });

  it("rejects boosting with insufficient balance", async () => {
    const creator = await trackUser(await createTestCreator());
    await expect(boostStream(creator.id)).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);
  });
});

describe("cancelBoost", () => {
  it("refunds the creator in full and ends the boost immediately", async () => {
    const { priceSantim } = await getBoostPricing();
    const creator = await trackUser(await createTestCreator());
    const admin = await trackUser(await createTestViewer());
    await fundWallet(creator.id, priceSantim);
    const boost = await boostStream(creator.id);
    expect(await getWalletBalance(creator.walletId)).toBe(0);

    await cancelBoost(admin.id, boost.id);

    expect(await getWalletBalance(creator.walletId)).toBe(priceSantim);
    const { rows } = await pool.query<{ ends_at: string; cancelled_at: string | null }>(
      `SELECT ends_at, cancelled_at FROM stream_boosts WHERE id = $1`,
      [boost.id]
    );
    expect(rows[0]!.cancelled_at).not.toBeNull();
    expect(new Date(rows[0]!.ends_at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects cancelling an already-cancelled boost", async () => {
    const { priceSantim } = await getBoostPricing();
    const creator = await trackUser(await createTestCreator());
    const admin = await trackUser(await createTestViewer());
    await fundWallet(creator.id, priceSantim);
    const boost = await boostStream(creator.id);

    await cancelBoost(admin.id, boost.id);
    await expect(cancelBoost(admin.id, boost.id)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("404s for an unknown boost id", async () => {
    const admin = await trackUser(await createTestViewer());
    await expect(cancelBoost(admin.id, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });
});
