import type {
  LedgerReconciliation,
  LedgerTransactionLookup,
  ManualAdjustmentInput,
  PlatformWalletSummary,
} from "@birq/shared";
import { logAdminAction } from "./audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";

// The core invariant the whole wallet system is built on — every
// ledger_entries row has a debit leg and a credit leg somewhere, so the
// two sums must always match exactly. Surfacing this as a checkable
// number is cheap and catches a real bug (a one-sided write, a missed
// insertEntry call) early rather than as a support ticket later.
export async function getLedgerReconciliation(): Promise<LedgerReconciliation> {
  const { rows } = await pool.query<{ credits: string | null; debits: string | null }>(
    `SELECT
       sum(CASE WHEN direction = 'credit' THEN amount_santim ELSE 0 END)::text AS credits,
       sum(CASE WHEN direction = 'debit' THEN amount_santim ELSE 0 END)::text AS debits
     FROM ledger_entries`
  );
  const totalCreditsSantim = Number(rows[0]?.credits ?? 0);
  const totalDebitsSantim = Number(rows[0]?.debits ?? 0);
  return { totalCreditsSantim, totalDebitsSantim, balanced: totalCreditsSantim === totalDebitsSantim };
}

export async function getPlatformWalletSummary(): Promise<PlatformWalletSummary> {
  const client = pool;
  const platformWalletId = await getPlatformWalletId(client);

  const [balance, daily] = await Promise.all([
    pool.query<{ balance_santim: number }>(`SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1`, [
      platformWalletId,
    ]),
    pool.query<{ day: string; net: string }>(
      `SELECT date_trunc('day', created_at)::date::text AS day,
              sum(CASE WHEN direction = 'credit' THEN amount_santim ELSE -amount_santim END)::text AS net
       FROM ledger_entries
       WHERE wallet_id = $1 AND created_at >= now() - interval '30 days'
       GROUP BY 1
       ORDER BY 1 ASC`,
      [platformWalletId]
    ),
  ]);

  return {
    currentBalanceSantim: balance.rows[0]?.balance_santim ?? 0,
    last30Days: daily.rows.map((row) => ({ day: row.day, netSantim: Number(row.net) })),
  };
}

// Accepts either a topup's tx_ref (ledger_transactions.reference) or a raw
// transaction id — whichever a support agent actually has on hand.
export async function searchLedgerTransaction(query: string): Promise<LedgerTransactionLookup[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // id::text = $1 (not id = $1::uuid) deliberately — casting the id column
  // instead of the input avoids reusing $1 across two different implicit
  // types in the same statement (text for the reference comparison, uuid
  // for an id comparison), which real-world testing against the deployed
  // API — not just a local query tool — showed silently matching nothing
  // instead of erroring. This form works whether or not the input even
  // looks like a UUID, no separate isUuid branch needed.
  const { rows: txRows } = await pool.query<{
    id: string;
    type: string;
    status: string;
    reference: string | null;
    created_at: string;
    completed_at: string | null;
  }>(
    `SELECT id, type, status, reference, created_at, completed_at
     FROM ledger_transactions
     WHERE reference = $1 OR id::text = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [trimmed]
  );
  if (txRows.length === 0) return [];

  const txIds = txRows.map((row) => row.id);
  const { rows: entryRows } = await pool.query<{
    id: string;
    ledger_transaction_id: string;
    wallet_owner_type: "user" | "platform";
    wallet_owner_username: string | null;
    direction: "debit" | "credit";
    amount_santim: number;
  }>(
    `SELECT le.id, le.ledger_transaction_id, w.owner_type AS wallet_owner_type, u.username AS wallet_owner_username,
            le.direction, le.amount_santim
     FROM ledger_entries le
     JOIN wallets w ON w.id = le.wallet_id
     LEFT JOIN users u ON u.id = w.owner_id AND w.owner_type = 'user'
     WHERE le.ledger_transaction_id = ANY($1)
     ORDER BY le.created_at ASC`,
    [txIds]
  );

  return txRows.map((tx) => ({
    id: tx.id,
    type: tx.type,
    status: tx.status,
    reference: tx.reference,
    createdAt: tx.created_at,
    completedAt: tx.completed_at,
    entries: entryRows
      .filter((e) => e.ledger_transaction_id === tx.id)
      .map((e) => ({
        id: e.id,
        walletOwnerType: e.wallet_owner_type,
        walletOwnerUsername: e.wallet_owner_username,
        direction: e.direction,
        amountSantim: e.amount_santim,
      })),
  }));
}

// A rare, heavily-logged capability — never a direct balance edit, always
// a real paired ledger transaction between the target user's wallet and
// the platform wallet, same double-entry invariant getLedgerReconciliation
// checks. credit_user: platform debits, user credits (a goodwill refund/
// correction in the user's favor). debit_user: the reverse (clawing back
// an error).
export async function performManualAdjustment(
  adminId: string,
  input: ManualAdjustmentInput
): Promise<{ ledgerTransactionId: string }> {
  const { rows: userRows } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
    input.targetUsername,
  ]);
  const targetUserId = userRows[0]?.id;
  if (!targetUserId) throw new AppError(404, "User not found");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userWalletId = await getUserWalletId(client, targetUserId);
    const platformWalletId = await getPlatformWalletId(client);

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('adjustment', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = rows[0]!.id;

    const userDirection = input.direction === "credit_user" ? "credit" : "debit";
    const platformDirection = input.direction === "credit_user" ? "debit" : "credit";
    const userDelta = input.direction === "credit_user" ? input.amountSantim : -input.amountSantim;

    await insertEntry(client, ledgerTransactionId, userWalletId, userDirection, input.amountSantim);
    await insertEntry(client, ledgerTransactionId, platformWalletId, platformDirection, input.amountSantim);
    await applyBalanceDelta(client, userWalletId, userDelta);
    await applyBalanceDelta(client, platformWalletId, -userDelta);

    await logAdminAction(adminId, "ledger.manual_adjustment", "ledger_transaction", ledgerTransactionId, {
      reason: input.reason,
      metadata: { targetUsername: input.targetUsername, amountSantim: input.amountSantim, direction: input.direction },
      client,
    });

    await client.query("COMMIT");
    return { ledgerTransactionId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
