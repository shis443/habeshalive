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
  fundCreatorEarnings,
  getGiftTypeId,
  getSubscriptionTierId,
  type TestUser,
} from "../test/fixtures.js";
import { getBoostPricing } from "./config-service.js";
import { getLedgerReconciliation, getTrialBalance } from "./ledger-service.js";
import { cancelBoost } from "./boosts-service.js";
import { bindPayoutInstrument, verifyPayoutInstrument } from "../wallet/payout-instruments-service.js";

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
    // ledger-writing operation, regardless of whether it's later approved).
    // The gift above only earns the creator a *pending* hold (14-day
    // clearing window, migration 0053) — not yet withdrawable — so this
    // test's payout draws on a separately-credited, already-cleared amount
    // instead, exactly as any real creator's own already-cleared earnings
    // would.
    createdUserIds.push(await fundCreatorEarnings(creator.id, 1_000));
    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });
    await pool.query(`UPDATE payout_instruments SET usable_from = now() - interval '1 second' WHERE id = $1`, [
      instrument.id,
    ]);
    await verifyPayoutInstrument(admin.id, instrument.id);
    await requestPayout(creator.id, { amountSantim: 1_000, instrumentId: instrument.id });

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

// T7 acceptance criterion: the trial balance strip must sum to zero drift
// under normal operation, and must actually surface a real disagreement if
// one exists — not just always report "balanced" regardless of input. See
// ledger-service.ts's getTrialBalance for why this checks cache-vs-ledger
// drift rather than a sum-to-zero invariant.
describe("trial balance", () => {
  it("shows zero drift after a normal, correctly-applied earning", async () => {
    const creator = await trackUser(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 12_345));

    const trialBalance = await getTrialBalance();

    expect(trialBalance.driftSantim).toBe(0);
    expect(trialBalance.balanced).toBe(true);
    expect(trialBalance.cachedSumSantim).toBe(trialBalance.ledgerDerivedSumSantim);
  });

  it("surfaces nonzero drift when a creator wallet's cache disagrees with its ledger entries", async () => {
    const creator = await trackUser(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 12_345));

    const clean = await getTrialBalance();
    expect(clean.balanced).toBe(true);

    // Simulate the exact class of bug this check exists to catch: a cache
    // write that silently diverged from the ledger (a missed
    // applyBalanceDelta call, a stray direct UPDATE) — never possible via
    // any real application code path, only reproducible here by writing
    // straight to wallet_balances_cache. This test creator's wallet is
    // deleted whole (cache row cascades with it) at cleanupTestUsers, so
    // there's nothing to restore afterward.
    await pool.query(
      `UPDATE wallet_balances_cache SET balance_santim = balance_santim + 777 WHERE wallet_id = $1`,
      [creator.walletId]
    );

    const corrupted = await getTrialBalance();

    expect(corrupted.driftSantim).toBe(clean.driftSantim + 777);
    expect(corrupted.balanced).toBe(false);
    expect(corrupted.cachedSumSantim).not.toBe(corrupted.ledgerDerivedSumSantim);
  });
});
