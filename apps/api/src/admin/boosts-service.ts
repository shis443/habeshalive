import type { BoostRevenueByCreator } from "@birq/shared";
import { logAdminAction } from "./audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";

export async function listBoostRevenueByCreator(): Promise<BoostRevenueByCreator[]> {
  const { rows } = await pool.query<{ username: string; boost_count: string; total: string }>(
    `SELECT u.username, count(*)::text AS boost_count, sum(b.price_santim)::text AS total
     FROM stream_boosts b
     JOIN users u ON u.id = b.creator_id
     WHERE b.cancelled_at IS NULL
     GROUP BY u.username
     ORDER BY sum(b.price_santim) DESC`
  );
  return rows.map((row) => ({
    creatorUsername: row.username,
    boostCount: Number(row.boost_count),
    totalSantim: Number(row.total),
  }));
}

// Refund scenario — ends the boost immediately (ends_at = now(), so it
// drops out of "is this creator boosted" checks right away) and reverses
// the original 100%-to-platform charge with a real paired ledger entry,
// same reversal shape rejectPayout() already uses.
export async function cancelBoost(adminId: string, boostId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ creator_id: string; price_santim: number; cancelled_at: string | null }>(
      `SELECT creator_id, price_santim, cancelled_at FROM stream_boosts WHERE id = $1 FOR UPDATE`,
      [boostId]
    );
    const boost = rows[0];
    if (!boost) throw new AppError(404, "Boost not found");
    if (boost.cancelled_at) throw new AppError(400, "Boost was already cancelled");

    const creatorWalletId = await getUserWalletId(client, boost.creator_id);
    const platformWalletId = await getPlatformWalletId(client);

    const { rows: txRows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('refund', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = txRows[0]!.id;

    await insertEntry(client, ledgerTransactionId, creatorWalletId, "credit", boost.price_santim);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "debit", boost.price_santim);
    await applyBalanceDelta(client, creatorWalletId, boost.price_santim);
    await applyBalanceDelta(client, platformWalletId, -boost.price_santim);

    await client.query(
      `UPDATE stream_boosts SET ends_at = now(), cancelled_at = now(), cancelled_by = $1 WHERE id = $2`,
      [adminId, boostId]
    );

    await logAdminAction(adminId, "boost.cancel", "boost", boostId, {
      metadata: { creatorId: boost.creator_id, refundedSantim: boost.price_santim },
      client,
    });

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
