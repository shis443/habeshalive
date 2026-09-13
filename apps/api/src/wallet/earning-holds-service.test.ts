import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { performManualAdjustment } from "../admin/ledger-service.js";
import {
  assertTransactionBalanced,
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  fundCreatorEarnings,
  getGiftTypeId,
  getWalletBalance,
  type TestUser,
} from "../test/fixtures.js";
import { requestPayout, sendGift } from "./service.js";
import { clearDueEarningHolds } from "./earning-holds-service.js";

// T2's acceptance criteria, verbatim: "Send a gift → creator sees
// pending, withdrawable is 0 ... Promotional coins can never reach a
// payout. Write the test that proves it." Every test here exercises the
// real production paths (sendGift, requestPayout, performManualAdjustment,
// clearDueEarningHolds) against the real test database — no mocked ledger
// or hand-rolled model of the balance/clearing rules, per this project's
// standing rule that an enforcement control's test must observe the real
// system.

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function getEarningHolds(
  creatorId: string
): Promise<Array<{ state: string; amount_santim: number }>> {
  const { rows } = await pool.query<{ state: string; amount_santim: number }>(
    `SELECT state, amount_santim FROM earning_holds WHERE creator_id = $1 ORDER BY created_at`,
    [creatorId]
  );
  return rows;
}

async function getWithdrawable(creatorId: string): Promise<number> {
  const { rows } = await pool.query<{ cleared_santim: number | null }>(
    `SELECT cleared_santim FROM v_creator_withdrawable WHERE creator_id = $1`,
    [creatorId]
  );
  return Number(rows[0]?.cleared_santim ?? 0);
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("earning holds — gift funded entirely from paid balance", () => {
  it("creates a pending hold and leaves withdrawable at 0 until cleared", async () => {
    const creator = await trackUser(await createTestCreator(8000)); // 80% to creator
    const viewer = await trackUser(await createTestViewer());
    await performManualAdjustment(
      (await createTestViewer()).id, // adminId — only used for the audit row, not permission-checked here
      { targetUsername: viewer.username, amountSantim: 10_000, direction: "credit_user", reason: "test funding", fundingBucket: "paid" }
    );

    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    const { id: ledgerTransactionId } = await sendGift(viewer.id, {
      streamId: creator.streamId,
      giftTypeId,
      quantity: 1,
    });
    await assertTransactionBalanced(ledgerTransactionId);

    const holds = await getEarningHolds(creator.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]!.state).toBe("pending");
    expect(await getWithdrawable(creator.id)).toBe(0);

    await expect(
      requestPayout(creator.id, { amountSantim: holds[0]!.amount_santim, method: "telebirr", destination: "0911234567" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("becomes withdrawable only after the clearing job runs past clears_at", async () => {
    const creator = await trackUser(await createTestCreator(8000));
    const viewer = await trackUser(await createTestViewer());
    await performManualAdjustment(
      (await createTestViewer()).id,
      { targetUsername: viewer.username, amountSantim: 10_000, direction: "credit_user", reason: "test funding", fundingBucket: "paid" }
    );

    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    // Real clock-advance, not a faked one: back-date the real row's
    // clears_at via direct SQL (the same shape a genuine 14-day wait would
    // produce), then run the actual clearDueEarningHolds() job against it.
    await pool.query(
      `UPDATE earning_holds SET clears_at = now() - interval '1 second' WHERE creator_id = $1 AND state = 'pending'`,
      [creator.id]
    );
    const clearedCount = await clearDueEarningHolds();
    expect(clearedCount).toBeGreaterThanOrEqual(1);

    const holds = await getEarningHolds(creator.id);
    expect(holds.every((h) => h.state === "cleared")).toBe(true);
    const withdrawable = await getWithdrawable(creator.id);
    expect(withdrawable).toBe(holds.reduce((sum, h) => sum + h.amount_santim, 0));
    expect(withdrawable).toBeGreaterThan(0);

    // Now the real payout path succeeds against the same money.
    const payout = await requestPayout(creator.id, {
      amountSantim: withdrawable,
      method: "telebirr",
      destination: "0911234567",
    });
    expect(payout.status).toBe("processing");
    expect(await getWithdrawable(creator.id)).toBe(0);
  });
});

describe("earning holds — promotional money can never reach a payout", () => {
  it("a gift funded entirely by the sender's promotional balance never creates a hold, even after clearing runs", async () => {
    const creator = await trackUser(await createTestCreator(8000));
    const viewer = await trackUser(await createTestViewer());
    await performManualAdjustment(
      (await createTestViewer()).id,
      { targetUsername: viewer.username, amountSantim: 10_000, direction: "credit_user", reason: "promo grant", fundingBucket: "promotional" }
    );

    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    const { id: ledgerTransactionId } = await sendGift(viewer.id, {
      streamId: creator.streamId,
      giftTypeId,
      quantity: 1,
    });
    await assertTransactionBalanced(ledgerTransactionId);

    // The creator was paid immediately and spendably — this is correct,
    // not a bug: only *withdrawability* is restricted, not spendability.
    expect(await getWalletBalance(creator.walletId)).toBeGreaterThan(0);

    // No hold was ever created for this credit — not "created and then
    // excluded," nothing to exclude.
    expect(await getEarningHolds(creator.id)).toHaveLength(0);
    expect(await getWithdrawable(creator.id)).toBe(0);

    // Running the clearing job changes nothing — there is no pending row
    // for it to promote.
    await clearDueEarningHolds();
    expect(await getWithdrawable(creator.id)).toBe(0);

    await expect(
      requestPayout(creator.id, { amountSantim: 1, method: "telebirr", destination: "0911234567" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("a gift funded by a mix of promotional and paid balance splits both the debit and the credit proportionally", async () => {
    const creator = await trackUser(await createTestCreator(8000)); // 80% to creator
    const viewer = await trackUser(await createTestViewer());
    const adminId = (await createTestViewer()).id;
    createdUserIds.push(adminId);
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    const { rows: priceRows } = await pool.query<{ price_santim: number }>(
      `SELECT price_santim FROM gift_types WHERE id = $1`,
      [giftTypeId]
    );
    const price = priceRows[0]!.price_santim; // read from the real seed data, not assumed

    // Exactly 50% promotional / 50% paid, matched to the gift's real
    // price — a clean split with no remainder, so every derived figure
    // below is exact rather than needing a truncation tolerance.
    const half = price / 2;
    await performManualAdjustment(adminId, {
      targetUsername: viewer.username,
      amountSantim: half,
      direction: "credit_user",
      reason: "promo grant",
      fundingBucket: "promotional",
    });
    await performManualAdjustment(adminId, {
      targetUsername: viewer.username,
      amountSantim: half,
      direction: "credit_user",
      reason: "paid grant",
      fundingBucket: "paid",
    });

    const { id: ledgerTransactionId } = await sendGift(viewer.id, {
      streamId: creator.streamId,
      giftTypeId,
      quantity: 1,
    });
    await assertTransactionBalanced(ledgerTransactionId);

    // creatorShare/platformShare are themselves split 50/50 promo/paid,
    // same ratio as the debit — this is the proportional-split invariant
    // creditCreatorFromViewerSpend exists to enforce.
    const creatorShare = Math.trunc((price * 8000) / 10_000);
    const expectedCreatorPaid = Math.trunc((creatorShare * half) / price);

    const holds = await getEarningHolds(creator.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]!.state).toBe("pending");
    expect(holds[0]!.amount_santim).toBe(expectedCreatorPaid);
    // The creator's real wallet balance includes BOTH the promo and paid
    // portions (promo money is spendable immediately) — only the paid
    // portion is held.
    expect(await getWalletBalance(creator.walletId)).toBe(creatorShare);
    expect(await getWithdrawable(creator.id)).toBe(0);
  });
});

describe("payout consumption — FIFO over cleared holds, with a splitting row", () => {
  it("consumes oldest-cleared-first, splits the straddling row, and restores it on reversal", async () => {
    const creator = await trackUser(await createTestCreator());
    createdUserIds.push(await fundCreatorEarnings(creator.id, 3_000));
    createdUserIds.push(await fundCreatorEarnings(creator.id, 4_000));

    const before = await getEarningHolds(creator.id);
    expect(before).toHaveLength(2);
    expect(before.every((h) => h.state === "cleared")).toBe(true);
    expect(await getWithdrawable(creator.id)).toBe(7_000);

    // Consumes the whole 3,000 row and splits the 4,000 row into a
    // 2,000-consumed slice and a 2,000-still-cleared remainder.
    const payout = await requestPayout(creator.id, {
      amountSantim: 5_000,
      method: "telebirr",
      destination: "0911234567",
    });
    expect(payout.status).toBe("processing");
    expect(await getWithdrawable(creator.id)).toBe(2_000);

    const afterConsumption = await getEarningHolds(creator.id);
    const paidOut = afterConsumption.filter((h) => h.state === "paid_out");
    const stillCleared = afterConsumption.filter((h) => h.state === "cleared");
    expect(paidOut.reduce((sum, h) => sum + h.amount_santim, 0)).toBe(5_000);
    expect(stillCleared.reduce((sum, h) => sum + h.amount_santim, 0)).toBe(2_000);

    // Reject the payout — a rejection reverses the ledger effect the same
    // way a failed transfer would, and must un-consume the holds it drew
    // on, or that 5,000 becomes real wallet balance with no way to ever
    // become withdrawable again.
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM payouts WHERE creator_id = $1`, [creator.id]);
    const { rejectPayout } = await import("./service.js");
    // rejectPayout only accepts a payout still in 'pending_review' — force
    // it there directly since this payout was auto-processing (below the
    // manual-review threshold), and this test only cares about the
    // consume/restore symmetry, not the review-threshold gate (already
    // covered elsewhere).
    await pool.query(`UPDATE payouts SET status = 'pending_review' WHERE id = $1`, [rows[0]!.id]);
    await rejectPayout(rows[0]!.id, creator.id, "test reversal");

    expect(await getWithdrawable(creator.id)).toBe(7_000);
    const afterReversal = await getEarningHolds(creator.id);
    expect(afterReversal.filter((h) => h.state === "paid_out")).toHaveLength(0);
    expect(afterReversal.reduce((sum, h) => sum + h.amount_santim, 0)).toBe(7_000);
  });
});
