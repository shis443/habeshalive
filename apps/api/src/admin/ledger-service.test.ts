import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { boostStream } from "../streams/service.js";
import { cancelSubscription, subscribe } from "../subscriptions/service.js";
import { cancelGiftCard, purchaseGiftCard, redeemGiftCard } from "../gift-cards/service.js";
import { completeTopupFromWebhook, initiateTopup, requestPayout, sendGift } from "../wallet/service.js";
import {
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getGiftTypeId,
  getSubscriptionTierId,
  type TestUser,
} from "../test/fixtures.js";
import { getBoostPricing } from "./config-service.js";
import { getLedgerReconciliation } from "./ledger-service.js";
import { cancelBoost } from "./boosts-service.js";

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

afterAll(async () => {
  if (createdGiftCardIds.length > 0) {
    await pool.query(`DELETE FROM gift_cards WHERE id = ANY($1)`, [createdGiftCardIds]);
  }
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

// This is the one test in the suite that isn't scoped to a single
// operation's own paired entries (every other money-path test already
// does that via assertTransactionBalanced) — it's the platform-wide
// invariant every one of those individual checks is supposed to add up
// to: after running one real operation of every money-moving type this
// platform has (topup, gift, subscription — including its cancellation,
// boost — including its admin refund, gift card — purchase, redemption,
// AND cancellation), the sum of every credit across the whole ledger
// still equals the sum of every debit. A single missed insertEntry call
// anywhere in any of these paths, even one that individually looked fine
// in isolation, would show up here as a nonzero delta.
describe("ledger invariant", () => {
  it("keeps total credits equal to total debits across every money-path operation type", async () => {
    const before = await getLedgerReconciliation();

    const creator = await trackUser(await createTestCreator(7500));
    const viewer = await trackUser(await createTestViewer());
    const subscriber = await trackUser(await createTestViewer());
    const giftCardPurchaser = await trackUser(await createTestViewer());
    const giftCardRedeemer = await trackUser(await createTestViewer());
    const admin = await trackUser(await createTestViewer());

    // topup
    await fundWallet(viewer.id, 200_000);
    await fundWallet(subscriber.id, 200_000);
    await fundWallet(giftCardPurchaser.id, 200_000);
    const { priceSantim: boostPriceSantim } = await getBoostPricing();
    await fundWallet(creator.id, boostPriceSantim);

    // gift
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    // subscription, then cancel it (cancellation itself doesn't move
    // money — access just lapses at expiry — but exercises the path)
    const tierId = await getSubscriptionTierId("Tier 1");
    const sub = await subscribe(subscriber.id, { creatorId: creator.id, tierId });
    await cancelSubscription(subscriber.id, sub.id);

    // boost, then admin-cancel/refund it
    const boost = await boostStream(creator.id);
    await cancelBoost(admin.id, boost.id);

    // gift card: purchase, redeem, and — on a second card — cancel
    const cardToRedeem = await purchaseGiftCard(giftCardPurchaser.id, {
      amountSantim: 10_000,
      designTheme: "generic_celebration",
      deliveryMethod: "link",
    });
    createdGiftCardIds.push(cardToRedeem.id);
    await redeemGiftCard(giftCardRedeemer.id, cardToRedeem.code);

    const cardToCancel = await purchaseGiftCard(giftCardPurchaser.id, {
      amountSantim: 5_000,
      designTheme: "generic_celebration",
      deliveryMethod: "link",
    });
    createdGiftCardIds.push(cardToCancel.id);
    await cancelGiftCard(admin.id, cardToCancel.id);

    // payout hold (reserves funds immediately, same as any other
    // ledger-writing operation, regardless of whether it's later approved)
    await requestPayout(creator.id, { amountSantim: 1_000, method: "telebirr", destination: "0911234567" });

    const after = await getLedgerReconciliation();

    expect(after.balanced).toBe(true);
    // Also confirm this test's own operations actually moved real,
    // nonzero money through the ledger — a suite where every operation
    // silently no-oped would trivially "balance" too.
    expect(after.totalCreditsSantim).toBeGreaterThan(before.totalCreditsSantim);
    expect(after.totalDebitsSantim).toBeGreaterThan(before.totalDebitsSantim);
    expect(after.totalCreditsSantim - before.totalCreditsSantim).toBe(
      after.totalDebitsSantim - before.totalDebitsSantim
    );
  });
});
