import { randomUUID } from "node:crypto";
import { getDefaultRevenueShareBps } from "../admin/config-service.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";

// Charges the buyer's wallet balance and records the purchase — same
// funding source and revenue-share split as a gift (wallet/service.ts's
// sendGift), just without a gift catalog item or gifter-badge/rank update:
// this is buying access to a broadcast, not a show of generosity toward
// the creator, so it deliberately doesn't feed into that prestige system.
// jti is returned so the caller (streams/routes.ts) can embed it in the
// access token it issues via reply.jwtSign — see 0033_donations_and_ppv.
// sql's comment on why verification re-checks ppv_purchases by
// (streamId, buyerId) rather than trusting the jti alone.
export async function purchasePpvAccess(buyerId: string, streamId: string): Promise<{ jti: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const streamResult = await client.query<{
      creator_id: string;
      is_ppv: boolean;
      ppv_price_santim: number | null;
      status: string;
    }>(`SELECT creator_id, is_ppv, ppv_price_santim, status FROM streams WHERE id = $1 FOR UPDATE`, [streamId]);
    const stream = streamResult.rows[0];
    if (!stream) throw new AppError(404, "Stream not found");
    if (!stream.is_ppv || !stream.ppv_price_santim) throw new AppError(400, "This stream isn't pay-per-view");
    if (stream.creator_id === buyerId) throw new AppError(400, "You can't buy access to your own stream");

    const existing = await client.query(`SELECT 1 FROM ppv_purchases WHERE stream_id = $1 AND buyer_id = $2`, [
      streamId,
      buyerId,
    ]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { jti: randomUUID() }; // Already owns it — a fresh token is fine, no new charge.
    }

    const price = stream.ppv_price_santim;

    const buyerWalletId = await getUserWalletId(client, buyerId);
    const creatorWalletId = await getUserWalletId(client, stream.creator_id);
    const platformWalletId = await getPlatformWalletId(client);

    const balanceResult = await client.query<{ balance_santim: number }>(
      `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
      [buyerWalletId]
    );
    const buyerBalance = balanceResult.rows[0]?.balance_santim ?? 0;
    if (buyerBalance < price) throw new AppError(400, "Insufficient balance");

    const { rows: profileRows } = await client.query<{ revenue_share_bps: number }>(
      `SELECT revenue_share_bps FROM creator_profiles WHERE user_id = $1`,
      [stream.creator_id]
    );
    const revenueShareBps = profileRows[0]?.revenue_share_bps ?? (await getDefaultRevenueShareBps());
    const creatorShare = Math.trunc((price * revenueShareBps) / 10_000);
    const platformShare = price - creatorShare;

    const { rows: txRows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, stream_id, status, completed_at)
       VALUES ('ppv_purchase', $1, 'completed', now()) RETURNING id`,
      [streamId]
    );
    const ledgerTransactionId = txRows[0]!.id;

    await insertEntry(client, ledgerTransactionId, buyerWalletId, "debit", price);
    await insertEntry(client, ledgerTransactionId, creatorWalletId, "credit", creatorShare);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", platformShare);

    await applyBalanceDelta(client, buyerWalletId, -price);
    await applyBalanceDelta(client, creatorWalletId, creatorShare);
    await applyBalanceDelta(client, platformWalletId, platformShare);

    const jti = randomUUID();
    await client.query(
      `INSERT INTO ppv_purchases (ledger_transaction_id, stream_id, buyer_id, amount_santim, access_token_jti)
       VALUES ($1, $2, $3, $4, $5)`,
      [ledgerTransactionId, streamId, buyerId, price, jti]
    );

    await client.query("COMMIT");
    return { jti };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function hasPpvAccess(streamId: string, viewerId: string | undefined): Promise<boolean> {
  if (!viewerId) return false;
  const { rows } = await pool.query(`SELECT 1 FROM ppv_purchases WHERE stream_id = $1 AND buyer_id = $2`, [
    streamId,
    viewerId,
  ]);
  return rows.length > 0;
}
