import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { completeTopupFromWebhook, initiateTopup } from "../wallet/service.js";
import {
  assertTransactionBalanced,
  cleanupTestUsers,
  createTestViewer,
  getWalletBalance,
  type TestUser,
} from "../test/fixtures.js";
import { cancelGiftCard, purchaseGiftCard, redeemGiftCard } from "./service.js";

const createdUserIds: string[] = [];
const createdGiftCardIds: string[] = [];

async function fundWallet(userId: string, amountSantim: number): Promise<void> {
  const { reference } = await initiateTopup(userId, amountSantim);
  await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: amountSantim, currency: "ETB" });
}

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function getGiftCardStatus(id: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM gift_cards WHERE id = $1`, [id]);
  return rows[0]!.status;
}

afterAll(async () => {
  // Gift cards aren't reachable from cleanupTestUsers via a user-id filter
  // alone once purchaser/redeemer are cleaned up first — delete these
  // explicitly before the user cleanup runs (cleanupTestUsers also does
  // this for any it can still find by id, this just covers whatever's left).
  if (createdGiftCardIds.length > 0) {
    await pool.query(`DELETE FROM gift_cards WHERE id = ANY($1)`, [createdGiftCardIds]);
  }
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("purchaseGiftCard", () => {
  it("debits the purchaser and issues a redeemable card", async () => {
    const purchaser = await trackUser(await createTestViewer());
    await fundWallet(purchaser.id, 50_000);

    const result = await purchaseGiftCard(purchaser.id, {
      amountSantim: 20_000,
      designTheme: "birthday",
      deliveryMethod: "link",
    });
    createdGiftCardIds.push(result.id);

    expect(result.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await getWalletBalance(purchaser.walletId)).toBe(30_000);
    expect(await getGiftCardStatus(result.id)).toBe("issued");

    const { rows } = await pool.query<{ ledger_transaction_id: string }>(
      `SELECT ledger_transaction_id FROM gift_cards WHERE id = $1`,
      [result.id]
    );
    await assertTransactionBalanced(rows[0]!.ledger_transaction_id);
  });

  it("rejects a purchase with insufficient balance", async () => {
    const purchaser = await trackUser(await createTestViewer());

    await expect(
      purchaseGiftCard(purchaser.id, { amountSantim: 10_000, designTheme: "birthday", deliveryMethod: "link" })
    ).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);
    expect(await getWalletBalance(purchaser.walletId)).toBe(0);
  });
});

describe("redeemGiftCard", () => {
  it("credits the redeemer the full card amount", async () => {
    const purchaser = await trackUser(await createTestViewer());
    const redeemer = await trackUser(await createTestViewer());
    await fundWallet(purchaser.id, 50_000);
    const card = await purchaseGiftCard(purchaser.id, {
      amountSantim: 15_000,
      designTheme: "birthday",
      deliveryMethod: "link",
    });
    createdGiftCardIds.push(card.id);

    const result = await redeemGiftCard(redeemer.id, card.code);

    expect(result.amountSantim).toBe(15_000);
    expect(await getWalletBalance(redeemer.walletId)).toBe(15_000);
    expect(await getGiftCardStatus(card.id)).toBe("redeemed");
  });

  it("rejects redeeming an already-redeemed card", async () => {
    const purchaser = await trackUser(await createTestViewer());
    const redeemer = await trackUser(await createTestViewer());
    await fundWallet(purchaser.id, 50_000);
    const card = await purchaseGiftCard(purchaser.id, {
      amountSantim: 5_000,
      designTheme: "birthday",
      deliveryMethod: "link",
    });
    createdGiftCardIds.push(card.id);

    await redeemGiftCard(redeemer.id, card.code);
    await expect(redeemGiftCard(redeemer.id, card.code)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
    // Balance shouldn't double-credit from the rejected second attempt.
    expect(await getWalletBalance(redeemer.walletId)).toBe(5_000);
  });

  it("rejects redeeming an unknown code", async () => {
    const redeemer = await trackUser(await createTestViewer());
    await expect(redeemGiftCard(redeemer.id, "ZZZZ-ZZZZ-ZZZZ")).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });
});

describe("cancelGiftCard", () => {
  it("reverses the purchase, refunding the purchaser and marking the card cancelled", async () => {
    const purchaser = await trackUser(await createTestViewer());
    const admin = await trackUser(await createTestViewer());
    await fundWallet(purchaser.id, 50_000);
    const card = await purchaseGiftCard(purchaser.id, {
      amountSantim: 12_000,
      designTheme: "birthday",
      deliveryMethod: "link",
    });
    createdGiftCardIds.push(card.id);
    expect(await getWalletBalance(purchaser.walletId)).toBe(38_000);

    await cancelGiftCard(admin.id, card.id);

    expect(await getWalletBalance(purchaser.walletId)).toBe(50_000);
    expect(await getGiftCardStatus(card.id)).toBe("cancelled");
  });

  it("rejects cancelling an already-redeemed card", async () => {
    const purchaser = await trackUser(await createTestViewer());
    const redeemer = await trackUser(await createTestViewer());
    const admin = await trackUser(await createTestViewer());
    await fundWallet(purchaser.id, 50_000);
    const card = await purchaseGiftCard(purchaser.id, {
      amountSantim: 8_000,
      designTheme: "birthday",
      deliveryMethod: "link",
    });
    createdGiftCardIds.push(card.id);
    await redeemGiftCard(redeemer.id, card.code);

    await expect(cancelGiftCard(admin.id, card.id)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });
});
