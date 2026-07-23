import type { SubscribeInput, SubscribeResponse, SubscriptionTier } from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";

export async function listTiers(): Promise<SubscriptionTier[]> {
  const { rows } = await pool.query<{ id: string; name: string; price_santim: number }>(
    `SELECT id, name, price_santim FROM subscription_tiers WHERE is_active = TRUE ORDER BY price_santim ASC`
  );
  return rows.map((row) => ({ id: row.id, name: row.name, priceSantim: row.price_santim }));
}

export async function subscribe(subscriberId: string, input: SubscribeInput): Promise<SubscribeResponse> {
  if (input.creatorId === subscriberId) {
    throw new AppError(400, "You can't subscribe to yourself");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tierResult = await client.query<{ name: string; price_santim: number; is_active: boolean }>(
      `SELECT name, price_santim, is_active FROM subscription_tiers WHERE id = $1`,
      [input.tierId]
    );
    const tier = tierResult.rows[0];
    if (!tier || !tier.is_active) throw new AppError(404, "Subscription tier not found");

    const profileResult = await client.query<{ revenue_share_bps: number }>(
      `SELECT revenue_share_bps FROM creator_profiles WHERE user_id = $1`,
      [input.creatorId]
    );
    const profile = profileResult.rows[0];
    if (!profile) throw new AppError(404, "Creator has no payout profile");

    const subscriberWalletId = await getUserWalletId(client, subscriberId);
    const creatorWalletId = await getUserWalletId(client, input.creatorId);
    const platformWalletId = await getPlatformWalletId(client);

    const balanceResult = await client.query<{ balance_santim: number }>(
      `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
      [subscriberWalletId]
    );
    const balance = balanceResult.rows[0]?.balance_santim ?? 0;
    if (balance < tier.price_santim) throw new AppError(400, "Insufficient balance");

    const creatorShare = Math.trunc((tier.price_santim * profile.revenue_share_bps) / 10_000);
    const platformShare = tier.price_santim - creatorShare;

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at)
       VALUES ('subscription', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = rows[0]!.id;

    await insertEntry(client, ledgerTransactionId, subscriberWalletId, "debit", tier.price_santim);
    await insertEntry(client, ledgerTransactionId, creatorWalletId, "credit", creatorShare);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", platformShare);

    await applyBalanceDelta(client, subscriberWalletId, -tier.price_santim);
    await applyBalanceDelta(client, creatorWalletId, creatorShare);
    await applyBalanceDelta(client, platformWalletId, platformShare);

    const subResult = await client.query<{ id: string; expires_at: string }>(
      `INSERT INTO subscriptions (ledger_transaction_id, subscriber_id, creator_id, tier_id, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 month')
       RETURNING id, expires_at`,
      [ledgerTransactionId, subscriberId, input.creatorId, input.tierId]
    );

    await client.query("COMMIT");
    return {
      id: subResult.rows[0]!.id,
      tierName: tier.name,
      expiresAt: subResult.rows[0]!.expires_at,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
