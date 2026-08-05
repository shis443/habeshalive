import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import {
  assertTransactionBalanced,
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getGiftTypeId,
  getSubscriptionTierId,
  getWalletBalance,
  type TestCreator,
  type TestUser,
} from "../test/fixtures.js";
import { subscribe } from "../subscriptions/service.js";
import {
  completeTopupFromWebhook,
  getBalance,
  initiateTopup,
  requestPayout,
  sendGift,
} from "./service.js";

const createdUserIds: string[] = [];

async function fundWallet(userId: string, amountSantim: number): Promise<void> {
  const { reference } = await initiateTopup(userId, amountSantim);
  await completeTopupFromWebhook({
    tx_ref: reference,
    status: "success",
    amount: amountSantim,
    currency: "ETB",
  });
}

async function getPlatformWalletId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM wallets WHERE owner_type = 'platform' AND currency = 'ETB' LIMIT 1`
  );
  return rows[0]!.id;
}

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("top-up", () => {
  it("credits the user wallet and debits the platform wallet on successful webhook", async () => {
    const viewer = await trackUser(await createTestViewer());
    const platformWalletId = await getPlatformWalletId();
    const platformBefore = await getWalletBalance(platformWalletId);

    const { reference } = await initiateTopup(viewer.id, 10_000);

    // Pending: not yet reflected in balance.
    expect(await getWalletBalance(viewer.walletId)).toBe(0);

    await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: 10_000, currency: "ETB" });

    expect(await getWalletBalance(viewer.walletId)).toBe(10_000);
    expect(await getWalletBalance(platformWalletId)).toBe(platformBefore - 10_000);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM ledger_transactions WHERE reference = $1`,
      [reference]
    );
    await assertTransactionBalanced(rows[0]!.id);

    const balance = await getBalance(viewer.id);
    expect(balance.balanceSantim).toBe(10_000);
  });

  it("is idempotent under webhook replay", async () => {
    const viewer = await trackUser(await createTestViewer());
    const { reference } = await initiateTopup(viewer.id, 5_000);

    const webhook = { tx_ref: reference, status: "success", amount: 5_000, currency: "ETB" };
    await completeTopupFromWebhook(webhook);
    await completeTopupFromWebhook(webhook);
    await completeTopupFromWebhook(webhook);

    expect(await getWalletBalance(viewer.walletId)).toBe(5_000);
  });

  it("marks the transaction failed and leaves the balance untouched on a failed webhook", async () => {
    const viewer = await trackUser(await createTestViewer());
    const { reference } = await initiateTopup(viewer.id, 7_500);

    await completeTopupFromWebhook({ tx_ref: reference, status: "failed", amount: 7_500, currency: "ETB" });

    expect(await getWalletBalance(viewer.walletId)).toBe(0);

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM ledger_transactions WHERE reference = $1`,
      [reference]
    );
    expect(rows[0]!.status).toBe("failed");
  });

  it("rejects a webhook for an unknown reference", async () => {
    await expect(
      completeTopupFromWebhook({ tx_ref: "topup_does_not_exist", status: "success", amount: 1, currency: "ETB" })
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("gift split", () => {
  let creator: TestCreator;

  beforeAll(async () => {
    creator = await trackUser(await createTestCreator(8000)); // 80% to creator
  });

  it("splits the gift amount between creator and platform per revenue_share_bps", async () => {
    const viewer = await trackUser(await createTestViewer());
    await fundWallet(viewer.id, 100_000);

    const platformWalletId = await getPlatformWalletId();
    const platformBefore = await getWalletBalance(platformWalletId);
    const creatorBefore = await getWalletBalance(creator.walletId);

    // Classic Mulmul is 10,000 santim as of 0025_gursha_gift_economy.sql
    // (was 2,500 pre-Gursha-gift-economy repricing).
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    const { id: ledgerTransactionId } = await sendGift(viewer.id, {
      streamId: creator.streamId,
      giftTypeId,
      quantity: 8, // total 80,000 santim
      message: "Keep it up!",
    });

    await assertTransactionBalanced(ledgerTransactionId);

    expect(await getWalletBalance(viewer.walletId)).toBe(100_000 - 80_000);
    expect(await getWalletBalance(creator.walletId)).toBe(creatorBefore + 64_000); // 80% of 80,000
    expect(await getWalletBalance(platformWalletId)).toBe(platformBefore + 16_000); // 20% of 80,000
  });

  it("rejects a gift when the sender has insufficient balance", async () => {
    const viewer = await trackUser(await createTestViewer());
    const giftTypeId = await getGiftTypeId("Classic Mulmul");

    await expect(
      sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 })
    ).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);

    expect(await getWalletBalance(viewer.walletId)).toBe(0);
  });

  it("splits exactly with no rounding leakage for an odd revenue share", async () => {
    const oddCreator = await trackUser(await createTestCreator(3333)); // 33.33%
    const viewer = await trackUser(await createTestViewer());
    await fundWallet(viewer.id, 100_000);

    // Uses a subscription charge, not a Gursha gift, deliberately: every
    // gift price as of 0025_gursha_gift_economy.sql (10,000/20,000/50,000/
    // 100,000 santim) is now an exact multiple of 10,000, which makes
    // Math.trunc((total * bps) / 10_000) always land on a whole number
    // with no remainder to truncate — structurally incapable of
    // exercising real rounding leakage anymore, no matter which bps or
    // quantity is chosen (k * 10_000 * bps / 10_000 = k * bps exactly,
    // for any integers k/bps). Tier 2 (25,000 santim) isn't a multiple of
    // 10,000, so it still genuinely tests truncation the same way "Golden
    // Mulmul" (2,500 santim, now retired) originally did.
    const tierId = await getSubscriptionTierId("Tier 2");
    const sub = await subscribe(viewer.id, { creatorId: oddCreator.id, tierId });
    const { rows: subRows } = await pool.query<{ ledger_transaction_id: string }>(
      `SELECT ledger_transaction_id FROM subscriptions WHERE id = $1`,
      [sub.id]
    );
    const ledgerTransactionId = subRows[0]!.ledger_transaction_id;

    await assertTransactionBalanced(ledgerTransactionId);

    const creatorBalance = await getWalletBalance(oddCreator.walletId);
    // Whatever the split, creator + platform delta must equal the total exactly
    // — assertTransactionBalanced above is the real check; this just confirms
    // the creator's share is a genuine partial amount, not 0 or the full total.
    expect(creatorBalance).toBeGreaterThan(0);
    expect(creatorBalance).toBeLessThan(25_000); // Tier 2's price — see comment above
  });
});

describe("payout hold", () => {
  it("debits the wallet immediately and does not require manual approval below the threshold", async () => {
    const creator = await trackUser(await createTestCreator());
    await fundWallet(creator.id, 100_000);

    const payout = await requestPayout(creator.id, {
      amountSantim: 50_000,
      method: "telebirr",
      destination: "0911234567",
    });

    expect(payout.requiresManualApproval).toBe(false);
    expect(payout.status).toBe("processing");
    expect(await getWalletBalance(creator.walletId)).toBe(50_000);
  });

  it("flags manual approval and still holds funds at/above the 5,000 ETB threshold", async () => {
    const creator = await trackUser(await createTestCreator());
    await fundWallet(creator.id, 600_000);

    const payout = await requestPayout(creator.id, {
      amountSantim: 500_000,
      method: "bank",
      destination: "1000123456789",
    });

    expect(payout.requiresManualApproval).toBe(true);
    expect(payout.status).toBe("pending_review");
    expect(await getWalletBalance(creator.walletId)).toBe(100_000);
  });

  it("rejects a payout larger than the available balance", async () => {
    const creator = await trackUser(await createTestCreator());
    await fundWallet(creator.id, 1_000);

    await expect(
      requestPayout(creator.id, { amountSantim: 5_000, method: "telebirr", destination: "0911234567" })
    ).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);

    expect(await getWalletBalance(creator.walletId)).toBe(1_000);
  });

  it("balances the ledger transaction for a held payout", async () => {
    const creator = await trackUser(await createTestCreator());
    await fundWallet(creator.id, 20_000);

    const payout = await requestPayout(creator.id, {
      amountSantim: 10_000,
      method: "telebirr",
      destination: "0911234567",
    });

    const { rows } = await pool.query<{ ledger_transaction_id: string }>(
      `SELECT ledger_transaction_id FROM payouts WHERE id = $1`,
      [payout.id]
    );
    await assertTransactionBalanced(rows[0]!.ledger_transaction_id);
  });
});
