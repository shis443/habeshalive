import type { PoolClient } from "pg";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

// Nightly clearing job (see server.ts) — moves a creator's 'pending'
// earning_holds rows to 'cleared' once their clears_at (14 days from
// creation, db/migrations/0053) has passed. This is the only thing that
// makes a gift/donation/PPV/subscription credit withdrawable: until this
// runs, the row sits outside v_creator_withdrawable's SUM by construction.
//
// A plain UPDATE, not a per-row loop — there is no per-row side effect to
// perform (no notification, no external call), so there is nothing a loop
// would buy that a single statement doesn't already do atomically.
export async function clearDueEarningHolds(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE earning_holds
     SET state = 'cleared', cleared_at = now()
     WHERE state = 'pending' AND clears_at <= now()`
  );
  return rowCount ?? 0;
}

// The only place a payout is allowed to check "can this creator withdraw
// this much" — v_creator_withdrawable's cleared_santim, not
// wallet_balances_cache's pooled balance (which also contains pending and
// promotional money that must never be payable out). Caller must already
// hold the transaction that will also write the payout row, since this
// both reads and mutates earning_holds under FOR UPDATE.
//
// Consumes 'cleared' rows oldest-cleared-first, flipping each to
// 'paid_out' — the row that straddles the requested amount is split so the
// unconsumed remainder stays 'cleared' and stays withdrawable. Throws if
// the creator's cleared total is short, which is the actual eligibility
// gate for a payout (see wallet/temporal/activities.ts's reserveFunds).
export async function consumeClearedEarningHoldsForPayout(
  client: PoolClient,
  creatorId: string,
  amountSantim: number,
  payoutId: string
): Promise<void> {
  const { rows } = await client.query<{ id: string; amount_santim: string }>(
    `SELECT id, amount_santim::text FROM earning_holds
     WHERE creator_id = $1 AND state = 'cleared'
     ORDER BY cleared_at ASC
     FOR UPDATE`,
    [creatorId]
  );

  let remaining = amountSantim;
  for (const row of rows) {
    if (remaining <= 0) break;
    const rowAmount = Number(row.amount_santim);
    if (rowAmount <= remaining) {
      await client.query(
        `UPDATE earning_holds SET state = 'paid_out', consumed_by_payout_id = $2 WHERE id = $1`,
        [row.id, payoutId]
      );
      remaining -= rowAmount;
    } else {
      // Split: shrink the original (still 'cleared') by the consumed
      // amount, and record the consumed slice as its own 'paid_out' row —
      // same creator/ledger_entry_id lineage, so it's still traceable back
      // to the credit that originally earned it.
      await client.query(`UPDATE earning_holds SET amount_santim = amount_santim - $2 WHERE id = $1`, [
        row.id,
        remaining,
      ]);
      await client.query(
        `INSERT INTO earning_holds (creator_id, ledger_entry_id, amount_santim, state, clears_at, cleared_at, consumed_by_payout_id)
         SELECT creator_id, ledger_entry_id, $2, 'paid_out', clears_at, cleared_at, $3
         FROM earning_holds WHERE id = $1`,
        [row.id, remaining, payoutId]
      );
      remaining = 0;
    }
  }

  if (remaining > 0) {
    throw new AppError(400, "Insufficient withdrawable balance");
  }
}

// Reverses consumeClearedEarningHoldsForPayout's effect when a payout
// fails after funds were reserved (wallet/temporal/activities.ts's
// reverseFunds) — every row that payout consumed goes back to 'cleared'.
// Split rows are not re-merged into the original row; leaving them as
// separate 'cleared' rows is correct (v_creator_withdrawable just sums
// them) and far simpler than reconstructing the pre-split state.
export async function restoreEarningHoldsForPayout(client: PoolClient, payoutId: string): Promise<void> {
  await client.query(
    `UPDATE earning_holds SET state = 'cleared', consumed_by_payout_id = NULL WHERE consumed_by_payout_id = $1`,
    [payoutId]
  );
}
