import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CreatePayoutBatchInput, EligibleCreatorForBatch, PayoutBatch, PayoutMethod } from "@birq/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import { notify } from "../notifications/service.js";
import { logAdminAction } from "./audit.js";
import { getKycRequiredForPayouts } from "./config-service.js";
import { hasApprovedKyc } from "../kyc/service.js";
import { chapaPayoutClient } from "../wallet/chapa-client.js";
import { consumeClearedEarningHoldsForPayout } from "../wallet/earning-holds-service.js";
import {
  decryptPayoutInstrumentAccountNumber,
  getVerifiedInstrumentForCreator,
} from "../wallet/payout-instruments-service.js";
import { reversePayoutLedger } from "../wallet/service.js";
import { hasVerifiedTaxProfile } from "../wallet/tax-profiles-service.js";

// T7 batch payouts — deliberately a plain sequential function
// (disbursePayoutBatch, at the bottom of this file), NOT a new Temporal
// workflow. The individual-payout Temporal migration exists to survive a
// worker crash mid-transfer for money moving unattended in response to a
// single creator's request; a batch is always initiated and watched by an
// admin in real time; a mid-batch crash leaves already-settled items
// 'paid' and the rest still 'processing', re-runnable by calling
// disbursePayoutBatch again (it only ever touches 'processing' items). A
// new workflow type here would duplicate that crash-recovery property
// without buying anything an admin re-clicking "disburse" doesn't already
// give for free.

interface BatchRow {
  id: string;
  reference: string;
  method: PayoutMethod;
  status: PayoutBatch["status"];
  total_santim: number;
  item_count: number;
  prepared_by_username: string;
  approved_by_username: string | null;
  approved_at: string | null;
  created_at: string;
}

function mapBatchRow(row: BatchRow): PayoutBatch {
  return {
    id: row.id,
    reference: row.reference,
    method: row.method,
    status: row.status,
    totalSantim: row.total_santim,
    itemCount: row.item_count,
    preparedByUsername: row.prepared_by_username,
    approvedByUsername: row.approved_by_username,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

const SELECT_BATCH = `
  SELECT pb.id, pb.reference, pb.method, pb.status, pb.total_santim, pb.item_count,
         pu.username AS prepared_by_username, au.username AS approved_by_username,
         pb.approved_at, pb.created_at
  FROM payout_batches pb
  JOIN users pu ON pu.id = pb.prepared_by
  LEFT JOIN users au ON au.id = pb.approved_by
`;

export async function getPayoutBatch(batchId: string): Promise<PayoutBatch | null> {
  const { rows } = await pool.query<BatchRow>(`${SELECT_BATCH} WHERE pb.id = $1`, [batchId]);
  return rows[0] ? mapBatchRow(rows[0]) : null;
}

export async function listPayoutBatches(): Promise<PayoutBatch[]> {
  const { rows } = await pool.query<BatchRow>(`${SELECT_BATCH} ORDER BY pb.created_at DESC LIMIT 100`);
  return rows.map(mapBatchRow);
}

// The eligibility list a batch builder screen shows before an admin picks
// who to include. Every creator who has ever bound an instrument for this
// method appears — eligible or not — with the specific reasons an
// ineligible one has, never silently hidden (per T7's own acceptance
// criterion). Scoped to creators with an instrument for THIS method: a
// creator who has never attempted to set up telebirr has no reason to
// show up on a telebirr batch screen at all.
export async function getEligibleCreatorsForBatch(method: PayoutMethod): Promise<EligibleCreatorForBatch[]> {
  const { rows: instrumentRows } = await pool.query<{
    creator_id: string;
    username: string;
    is_suspended: boolean;
    instrument_status: string;
    usable_from: string;
  }>(
    `SELECT DISTINCT ON (pi.creator_id)
       pi.creator_id, u.username, u.is_suspended, pi.status AS instrument_status, pi.usable_from
     FROM payout_instruments pi
     JOIN users u ON u.id = pi.creator_id
     WHERE pi.method = $1
     ORDER BY pi.creator_id, (pi.status = 'verified') DESC, pi.created_at DESC`,
    [method]
  );
  if (instrumentRows.length === 0) return [];

  const creatorIds = instrumentRows.map((row) => row.creator_id);
  const [withdrawableResult, kycRequired] = await Promise.all([
    pool.query<{ creator_id: string; withdrawable: string }>(
      `SELECT creator_id, COALESCE(SUM(amount_santim), 0)::text AS withdrawable
       FROM earning_holds WHERE creator_id = ANY($1) AND state = 'cleared' GROUP BY creator_id`,
      [creatorIds]
    ),
    getKycRequiredForPayouts(),
  ]);
  const withdrawableByCreator = new Map(
    withdrawableResult.rows.map((row) => [row.creator_id, Number(row.withdrawable)])
  );

  const results: EligibleCreatorForBatch[] = [];
  for (const row of instrumentRows) {
    const blockingReasons: string[] = [];
    const withdrawableSantim = withdrawableByCreator.get(row.creator_id) ?? 0;

    if (row.is_suspended) blockingReasons.push("Payout privileges suspended");
    if (row.instrument_status !== "verified") {
      blockingReasons.push(`No verified ${method} instrument on file`);
    } else if (new Date(row.usable_from).getTime() > Date.now()) {
      blockingReasons.push(`Instrument still in its 72-hour cooling-off period (usable from ${row.usable_from})`);
    }
    if (withdrawableSantim <= 0) blockingReasons.push("No withdrawable (cleared) balance");
    if (kycRequired && !(await hasApprovedKyc(row.creator_id))) blockingReasons.push("KYC not approved");
    if (!(await hasVerifiedTaxProfile(row.creator_id))) blockingReasons.push("Tax profile not verified");

    results.push({
      creatorId: row.creator_id,
      username: row.username,
      withdrawableSantim,
      eligible: blockingReasons.length === 0,
      blockingReasons,
    });
  }
  return results;
}

// Re-validated fresh at creation time, not trusted from whatever the
// eligibility screen showed a moment earlier — same "the workflow never
// re-derives eligibility, the gate does" reasoning as
// payout-instruments-service.ts's getUsableVerifiedInstrument, just
// resolving from creatorId+method instead of a caller-supplied
// instrumentId (a batch selection is only ever {creatorId, amountSantim}).
async function assertCreatorEligibleForBatch(
  client: PoolClient,
  creatorId: string,
  method: PayoutMethod
): Promise<{ instrumentId: string; bankCode: string | null }> {
  const { rows } = await client.query<{ is_suspended: boolean; display_name: string }>(
    `SELECT is_suspended, display_name FROM users WHERE id = $1`,
    [creatorId]
  );
  const user = rows[0];
  if (!user) throw new AppError(404, `Creator ${creatorId} not found`);
  if (user.is_suspended) throw new AppError(400, `${user.display_name}'s payout privileges are currently suspended`);

  const instrument = await getVerifiedInstrumentForCreator(creatorId);
  if (!instrument || instrument.method !== method) {
    throw new AppError(400, `${user.display_name} has no verified ${method} instrument`);
  }
  if (new Date(instrument.usableFrom).getTime() > Date.now()) {
    throw new AppError(400, `${user.display_name}'s instrument is still in its 72-hour cooling-off period`);
  }
  if (await getKycRequiredForPayouts()) {
    if (!(await hasApprovedKyc(creatorId))) throw new AppError(400, `${user.display_name} has not completed KYC`);
  }
  if (!(await hasVerifiedTaxProfile(creatorId))) {
    throw new AppError(400, `${user.display_name} has no verified tax profile`);
  }
  return { instrumentId: instrument.id, bankCode: instrument.bankCode };
}

// Reserves funds for every selected creator in one transaction, the same
// way requestPayoutLegacy reserves a single one — a debit/credit ledger
// pair plus consuming cleared earning_holds per creator, each tagged with
// this batch's id. Every item always requires_manual_approval (the
// four-eyes approval below), regardless of amount: a batch is inherently
// a bulk, admin-initiated action, not a threshold-gated one.
export async function createPayoutBatch(
  adminId: string,
  input: CreatePayoutBatchInput
): Promise<PayoutBatch> {
  const { method, selections } = input;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // reference is VARCHAR(40) — a bare UUID (36 chars) fits, "batch_" + UUID
    // (42) doesn't.
    const reference = randomUUID();
    const { rows: batchRows } = await client.query<{ id: string }>(
      `INSERT INTO payout_batches (reference, method, status, total_santim, item_count, prepared_by)
       VALUES ($1, $2, 'pending_approval', 0, 0, $3) RETURNING id`,
      [reference, method, adminId]
    );
    const batchId = batchRows[0]!.id;

    let totalSantim = 0;
    for (const selection of selections) {
      const { instrumentId, bankCode } = await assertCreatorEligibleForBatch(client, selection.creatorId, method);

      const creatorWalletId = await getUserWalletId(client, selection.creatorId);
      const platformWalletId = await getPlatformWalletId(client);
      const { rows: txRows } = await client.query<{ id: string }>(
        `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('payout', 'completed', now()) RETURNING id`
      );
      const ledgerTransactionId = txRows[0]!.id;

      const { rows: payoutRows } = await client.query<{ id: string }>(
        `INSERT INTO payouts (ledger_transaction_id, creator_id, amount_santim, method, bank_code, instrument_id, batch_id, status, requires_manual_approval)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_review', true) RETURNING id`,
        [ledgerTransactionId, selection.creatorId, selection.amountSantim, method, bankCode, instrumentId, batchId]
      );
      const payoutId = payoutRows[0]!.id;

      // Throws "Insufficient withdrawable balance" (400) if this
      // creator's selection exceeds their cleared holds — rolls back the
      // whole batch rather than silently creating a partial one.
      await consumeClearedEarningHoldsForPayout(client, selection.creatorId, selection.amountSantim, payoutId);

      await insertEntry(client, ledgerTransactionId, creatorWalletId, "debit", selection.amountSantim);
      await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", selection.amountSantim);
      await applyBalanceDelta(client, creatorWalletId, -selection.amountSantim);
      await applyBalanceDelta(client, platformWalletId, selection.amountSantim);

      totalSantim += selection.amountSantim;
    }

    await client.query(`UPDATE payout_batches SET total_santim = $1, item_count = $2 WHERE id = $3`, [
      totalSantim,
      selections.length,
      batchId,
    ]);

    await logAdminAction(adminId, "payout_batch.create", "payout_batch", batchId, {
      metadata: { method, itemCount: selections.length, totalSantim },
      client,
    });

    await client.query("COMMIT");
    return (await getPayoutBatch(batchId))!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Four-eyes review, acceptance criterion #1: a preparer cannot approve
// their own batch. Checked HERE, before any DB write is attempted, so a
// self-approval attempt gets a clear 403 naming the problem — the
// payout_batch_four_eyes CHECK constraint (0061) still exists underneath
// as defense in depth (e.g. against a direct SQL update bypassing this
// service entirely), but a real admin using the real API should never see
// a raw constraint-violation error for this.
export async function approvePayoutBatch(adminId: string, batchId: string): Promise<void> {
  const { rows } = await pool.query<{ prepared_by: string; status: string }>(
    `SELECT prepared_by, status FROM payout_batches WHERE id = $1`,
    [batchId]
  );
  const batch = rows[0];
  if (!batch) throw new AppError(404, "Payout batch not found");
  if (batch.status !== "pending_approval") throw new AppError(400, `Batch is ${batch.status}, not awaiting approval`);
  if (batch.prepared_by === adminId) {
    throw new AppError(403, "You prepared this batch — a different admin must approve it (four-eyes review)");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: updated } = await client.query<{ id: string }>(
      `UPDATE payout_batches SET status = 'approved', approved_by = $1, approved_at = now()
       WHERE id = $2 AND status = 'pending_approval' RETURNING id`,
      [adminId, batchId]
    );
    if (!updated[0]) throw new AppError(409, "Batch was already acted on");

    await client.query(`UPDATE payouts SET status = 'processing' WHERE batch_id = $1 AND status = 'pending_review'`, [
      batchId,
    ]);

    await logAdminAction(adminId, "payout_batch.approve", "payout_batch", batchId, { client });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectPayoutBatch(adminId: string, batchId: string, reason: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM payout_batches WHERE id = $1 FOR UPDATE`,
      [batchId]
    );
    const batch = rows[0];
    if (!batch) throw new AppError(404, "Payout batch not found");
    if (batch.status !== "pending_approval") throw new AppError(400, `Batch is ${batch.status}, not awaiting approval`);

    const { rows: payoutRows } = await client.query<{ id: string; creator_id: string; amount_santim: number }>(
      `SELECT id, creator_id, amount_santim FROM payouts WHERE batch_id = $1 AND status = 'pending_review' FOR UPDATE`,
      [batchId]
    );
    for (const payout of payoutRows) {
      await reversePayoutLedger(client, payout.creator_id, payout.amount_santim, payout.id);
      await client.query(`UPDATE payouts SET status = 'failed', failure_reason = $1, rejected_by = $2 WHERE id = $3`, [
        reason,
        adminId,
        payout.id,
      ]);
    }

    await client.query(`UPDATE payout_batches SET status = 'rejected' WHERE id = $1`, [batchId]);
    await logAdminAction(adminId, "payout_batch.reject", "payout_batch", batchId, { reason, client });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Plain sequential disbursement — see this file's header comment for why
// this is deliberately not a Temporal workflow. Re-runnable: only ever
// touches items still in 'processing', so calling this again after a
// partial failure (or a server restart mid-loop) picks up exactly where
// it left off instead of re-transferring an already-'paid' item.
export async function disbursePayoutBatch(
  adminId: string,
  batchId: string
): Promise<{ succeeded: number; failed: number }> {
  const { rows: batchRows } = await pool.query<{ status: string }>(`SELECT status FROM payout_batches WHERE id = $1`, [
    batchId,
  ]);
  const batch = batchRows[0];
  if (!batch) throw new AppError(404, "Payout batch not found");
  if (batch.status !== "approved" && batch.status !== "processing") {
    throw new AppError(400, `Batch is ${batch.status}, not approved for disbursement`);
  }

  await pool.query(`UPDATE payout_batches SET status = 'processing' WHERE id = $1`, [batchId]);

  const { rows: items } = await pool.query<{
    id: string;
    creator_id: string;
    amount_santim: number;
    instrument_id: string;
    display_name: string;
  }>(
    `SELECT p.id, p.creator_id, p.amount_santim, p.instrument_id, u.display_name
     FROM payouts p JOIN users u ON u.id = p.creator_id
     WHERE p.batch_id = $1 AND p.status = 'processing'`,
    [batchId]
  );

  let succeeded = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const { rows: instrumentRows } = await pool.query<{ bank_code: string | null }>(
        `SELECT bank_code FROM payout_instruments WHERE id = $1`,
        [item.instrument_id]
      );
      const bankCode = instrumentRows[0]?.bank_code;
      if (!bankCode) throw new Error("Payout instrument has no bank_code");
      // Decrypted here and nowhere else — same "only at the moment Chapa
      // actually needs it" rule as wallet/temporal/activities.ts's
      // initiateChapaTransfer.
      const accountNumber = await decryptPayoutInstrumentAccountNumber(item.instrument_id);
      const { chapaReference } = await chapaPayoutClient.initiateTransfer({
        accountNumber,
        accountName: item.display_name,
        amountSantim: item.amount_santim,
        bankCode,
        reference: item.id,
      });
      await pool.query(`UPDATE payouts SET status = 'paid', paid_at = now(), chapa_reference = $1 WHERE id = $2`, [
        chapaReference,
        item.id,
      ]);
      await notify(item.creator_id, "payout_processed", "Your payout was sent", {
        body: `${(item.amount_santim / 100).toFixed(2)} birr is on its way`,
        linkUrl: "/wallet",
      });
      succeeded++;
    } catch (err) {
      const reverseClient = await pool.connect();
      try {
        await reverseClient.query("BEGIN");
        await reversePayoutLedger(reverseClient, item.creator_id, item.amount_santim, item.id);
        await reverseClient.query(`UPDATE payouts SET status = 'failed', failure_reason = $1 WHERE id = $2`, [
          err instanceof Error ? err.message : "Transfer initiation failed",
          item.id,
        ]);
        await reverseClient.query("COMMIT");
      } catch (reverseErr) {
        await reverseClient.query("ROLLBACK");
        throw reverseErr;
      } finally {
        reverseClient.release();
      }
      await notify(item.creator_id, "payout_failed", "Your payout failed", {
        body: "It's been refunded to your wallet balance — check Wallet for details",
        linkUrl: "/wallet",
      });
      failed++;
    }
  }

  await pool.query(`UPDATE payout_batches SET status = 'settled' WHERE id = $1`, [batchId]);
  await logAdminAction(adminId, "payout_batch.disburse", "payout_batch", batchId, {
    metadata: { succeeded, failed },
  });

  return { succeeded, failed };
}
