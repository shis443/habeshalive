import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import {
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  fundCreatorEarnings,
  type TestCreator,
  type TestUser,
} from "../test/fixtures.js";
import { bindPayoutInstrument, verifyPayoutInstrument } from "../wallet/payout-instruments-service.js";
import { submitTaxProfile, verifyTaxProfile } from "../wallet/tax-profiles-service.js";
import {
  approvePayoutBatch,
  createPayoutBatch,
  disbursePayoutBatch,
  getEligibleCreatorsForBatch,
  getPayoutBatch,
  rejectPayoutBatch,
} from "./payout-batches-service.js";

// T7 acceptance criteria this file exists to prove:
//   1. A preparer cannot approve their own batch — at BOTH the API layer
//      (a clean AppError before any DB write) and the DB layer (the
//      payout_batch_four_eyes CHECK constraint, migration 0061).
//   2. Building/approving a batch respects every real eligibility gate a
//      batch relies on (verified instrument past its cooling-off,
//      verified tax profile, cleared withdrawable balance).
//   3. Disbursement and rejection both leave the ledger in a real,
//      internally-consistent state — not asserted separately here since
//      assertTransactionBalanced-style checks belong to the ledger paths
//      these reuse (reversePayoutLedger, consumeClearedEarningHoldsForPayout),
//      already covered by wallet/service.test.ts and earning-holds-
//      service.test.ts.

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function fullyEligibleCreator(amountSantim = 20_000): Promise<{ creator: TestCreator; admin: TestUser }> {
  const creator = await trackUser(await createTestCreator());
  const admin = await trackUser(await createTestViewer());
  createdUserIds.push(await fundCreatorEarnings(creator.id, amountSantim));

  const instrument = await bindPayoutInstrument(creator.id, {
    method: "telebirr",
    accountNumber: "0911234567",
    accountHolder: creator.username,
  });
  // verifyPayoutInstrument recomputes usable_from = now() + 72h itself
  // (a real bug fix — the window used to stay fixed at bind time), so the
  // backdate has to happen after verify, not before.
  await verifyPayoutInstrument(admin.id, instrument.id);
  await pool.query(`UPDATE payout_instruments SET usable_from = now() - interval '1 second' WHERE id = $1`, [
    instrument.id,
  ]);

  const profile = await submitTaxProfile(creator.id, { residency: "et_resident" });
  await verifyTaxProfile(admin.id, profile.id, 0);

  return { creator, admin };
}

async function getWalletBalance(walletId: string): Promise<number> {
  const { rows } = await pool.query<{ balance_santim: number }>(
    `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1`,
    [walletId]
  );
  return rows[0]?.balance_santim ?? 0;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("getEligibleCreatorsForBatch", () => {
  it("lists a fully set-up creator as eligible with no blocking reasons", async () => {
    const { creator } = await fullyEligibleCreator();

    const list = await getEligibleCreatorsForBatch("telebirr");
    const entry = list.find((row) => row.creatorId === creator.id);

    expect(entry).toBeDefined();
    expect(entry!.eligible).toBe(true);
    expect(entry!.blockingReasons).toEqual([]);
    expect(entry!.withdrawableSantim).toBe(20_000);
  });

  it("never hides an ineligible creator — surfaces the specific blocking reasons instead", async () => {
    const creator = await trackUser(await createTestCreator());
    // Bound but never verified, and no tax profile submitted at all.
    await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: creator.username,
    });

    const list = await getEligibleCreatorsForBatch("telebirr");
    const entry = list.find((row) => row.creatorId === creator.id);

    expect(entry).toBeDefined();
    expect(entry!.eligible).toBe(false);
    expect(entry!.blockingReasons).toContain("No verified telebirr instrument on file");
    expect(entry!.blockingReasons).toContain("No withdrawable (cleared) balance");
    expect(entry!.blockingReasons).toContain("Tax profile not verified");
  });
});

describe("createPayoutBatch", () => {
  it("reserves funds for every selection and leaves items pending_review under the batch", async () => {
    const { creator, admin } = await fullyEligibleCreator();
    const balanceBefore = await getWalletBalance(creator.walletId);

    const batch = await createPayoutBatch(admin.id, {
      method: "telebirr",
      selections: [{ creatorId: creator.id, amountSantim: 15_000 }],
    });

    expect(batch.status).toBe("pending_approval");
    expect(batch.totalSantim).toBe(15_000);
    expect(batch.itemCount).toBe(1);
    expect(await getWalletBalance(creator.walletId)).toBe(balanceBefore - 15_000);

    const { rows } = await pool.query<{ status: string; batch_id: string }>(
      `SELECT status, batch_id FROM payouts WHERE creator_id = $1`,
      [creator.id]
    );
    expect(rows[0]!.status).toBe("pending_review");
    expect(rows[0]!.batch_id).toBe(batch.id);
  });

  it("rolls back the whole batch if one selection exceeds its creator's withdrawable balance", async () => {
    const { creator: creatorA, admin } = await fullyEligibleCreator(5_000);
    const { creator: creatorB } = await fullyEligibleCreator(20_000);

    await expect(
      createPayoutBatch(admin.id, {
        method: "telebirr",
        selections: [
          { creatorId: creatorA.id, amountSantim: 50_000 }, // exceeds creatorA's 5,000
          { creatorId: creatorB.id, amountSantim: 10_000 },
        ],
      })
    ).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<AppError>);

    // Neither leg should have taken effect — atomicity across the batch.
    expect(await getWalletBalance(creatorB.walletId)).toBe(20_000);
  });
});

describe("approvePayoutBatch — four-eyes review", () => {
  it("rejects self-approval at the API layer before touching the database", async () => {
    const { creator, admin } = await fullyEligibleCreator();
    const batch = await createPayoutBatch(admin.id, {
      method: "telebirr",
      selections: [{ creatorId: creator.id, amountSantim: 5_000 }],
    });

    await expect(approvePayoutBatch(admin.id, batch.id)).rejects.toMatchObject({ statusCode: 403 });

    // Untouched — still awaiting approval, not silently advanced.
    const stillPending = await getPayoutBatch(batch.id);
    expect(stillPending!.status).toBe("pending_approval");
  });

  it("also rejects self-approval at the database layer, independent of the service", async () => {
    const { creator, admin } = await fullyEligibleCreator();
    const batch = await createPayoutBatch(admin.id, {
      method: "telebirr",
      selections: [{ creatorId: creator.id, amountSantim: 5_000 }],
    });

    // Bypasses the service entirely — proves the payout_batch_four_eyes
    // CHECK constraint (0061) holds even against a direct SQL statement,
    // not just against approvePayoutBatch's own guard above.
    await expect(
      pool.query(`UPDATE payout_batches SET approved_by = $1, approved_at = now() WHERE id = $2`, [
        admin.id,
        batch.id,
      ])
    ).rejects.toThrow(/payout_batch_four_eyes/);
  });

  it("succeeds when a different admin approves, moving items to processing", async () => {
    const { creator, admin: preparer } = await fullyEligibleCreator();
    const approver = await trackUser(await createTestViewer());
    const batch = await createPayoutBatch(preparer.id, {
      method: "telebirr",
      selections: [{ creatorId: creator.id, amountSantim: 5_000 }],
    });

    await approvePayoutBatch(approver.id, batch.id);

    const approved = await getPayoutBatch(batch.id);
    expect(approved!.status).toBe("approved");
    expect(approved!.approvedByUsername).toBe(approver.username);

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM payouts WHERE creator_id = $1`, [
      creator.id,
    ]);
    expect(rows[0]!.status).toBe("processing");
  });
});

describe("disbursePayoutBatch", () => {
  it("pays out every approved item and settles the batch", async () => {
    const { creator, admin: preparer } = await fullyEligibleCreator();
    const approver = await trackUser(await createTestViewer());
    const batch = await createPayoutBatch(preparer.id, {
      method: "telebirr",
      selections: [{ creatorId: creator.id, amountSantim: 5_000 }],
    });
    await approvePayoutBatch(approver.id, batch.id);

    const result = await disbursePayoutBatch(approver.id, batch.id);

    expect(result).toEqual({ succeeded: 1, failed: 0 });
    const settled = await getPayoutBatch(batch.id);
    expect(settled!.status).toBe("settled");

    const { rows } = await pool.query<{ status: string; chapa_reference: string | null }>(
      `SELECT status, chapa_reference FROM payouts WHERE creator_id = $1`,
      [creator.id]
    );
    expect(rows[0]!.status).toBe("paid");
    expect(rows[0]!.chapa_reference).toMatch(/^stub_transfer_/);
  });
});

describe("rejectPayoutBatch", () => {
  it("reverses the reservation and restores withdrawable balance", async () => {
    const { creator, admin: preparer } = await fullyEligibleCreator();
    const approver = await trackUser(await createTestViewer());
    const balanceBefore = await getWalletBalance(creator.walletId);
    const batch = await createPayoutBatch(preparer.id, {
      method: "telebirr",
      selections: [{ creatorId: creator.id, amountSantim: 5_000 }],
    });
    expect(await getWalletBalance(creator.walletId)).toBe(balanceBefore - 5_000);

    await rejectPayoutBatch(approver.id, batch.id, "Bulk review found a duplicate submission");

    expect(await getWalletBalance(creator.walletId)).toBe(balanceBefore);
    const rejected = await getPayoutBatch(batch.id);
    expect(rejected!.status).toBe("rejected");

    const { rows } = await pool.query<{ status: string; failure_reason: string | null }>(
      `SELECT status, failure_reason FROM payouts WHERE creator_id = $1`,
      [creator.id]
    );
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.failure_reason).toBe("Bulk review found a duplicate submission");
  });
});
