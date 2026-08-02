import type {
  MySubscription,
  SubscribeInput,
  SubscribeResponse,
  SubscriptionAdminItem,
  SubscriptionTier,
} from "@habeshalive/shared";
import type { PoolClient } from "pg";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import { notify } from "../notifications/service.js";

export async function listTiers(): Promise<SubscriptionTier[]> {
  const { rows } = await pool.query<{ id: string; name: string; price_santim: number }>(
    `SELECT id, name, price_santim FROM subscription_tiers WHERE is_active = TRUE ORDER BY price_santim ASC`
  );
  return rows.map((row) => ({ id: row.id, name: row.name, priceSantim: row.price_santim }));
}

// Shared by subscribe() (first period) and renewSubscriptions() (every
// period after) — same wallet-debit pattern gifts already use: subscriber
// wallet -> creator wallet + platform wallet, split by revenue_share_bps.
// Returns null on insufficient balance rather than throwing, since the
// renewal job needs to keep processing the rest of the batch on one
// subscriber's failed charge, not abort the whole run.
async function chargeSubscriptionOrNull(
  client: PoolClient,
  subscriberId: string,
  creatorId: string,
  priceSantim: number
): Promise<string | null> {
  const profileResult = await client.query<{ revenue_share_bps: number }>(
    `SELECT revenue_share_bps FROM creator_profiles WHERE user_id = $1`,
    [creatorId]
  );
  const profile = profileResult.rows[0];
  if (!profile) throw new AppError(404, "Creator has no payout profile");

  const subscriberWalletId = await getUserWalletId(client, subscriberId);
  const creatorWalletId = await getUserWalletId(client, creatorId);
  const platformWalletId = await getPlatformWalletId(client);

  const balanceResult = await client.query<{ balance_santim: number }>(
    `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
    [subscriberWalletId]
  );
  const balance = balanceResult.rows[0]?.balance_santim ?? 0;
  if (balance < priceSantim) return null;

  const creatorShare = Math.trunc((priceSantim * profile.revenue_share_bps) / 10_000);
  const platformShare = priceSantim - creatorShare;

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions (type, status, completed_at)
     VALUES ('subscription', 'completed', now()) RETURNING id`
  );
  const ledgerTransactionId = rows[0]!.id;

  await insertEntry(client, ledgerTransactionId, subscriberWalletId, "debit", priceSantim);
  await insertEntry(client, ledgerTransactionId, creatorWalletId, "credit", creatorShare);
  await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", platformShare);

  await applyBalanceDelta(client, subscriberWalletId, -priceSantim);
  await applyBalanceDelta(client, creatorWalletId, creatorShare);
  await applyBalanceDelta(client, platformWalletId, platformShare);

  return ledgerTransactionId;
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

    const ledgerTransactionId = await chargeSubscriptionOrNull(client, subscriberId, input.creatorId, tier.price_santim);
    if (!ledgerTransactionId) throw new AppError(400, "Insufficient balance");

    const subResult = await client.query<{ id: string; expires_at: string }>(
      `INSERT INTO subscriptions (ledger_transaction_id, subscriber_id, creator_id, tier_id, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 month')
       RETURNING id, expires_at`,
      [ledgerTransactionId, subscriberId, input.creatorId, input.tierId]
    );

    await client.query("COMMIT");

    const { rows: subscriberRows } = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [subscriberId]
    );
    await notify(
      input.creatorId,
      "subscription_new",
      `${subscriberRows[0]?.display_name ?? "Someone"} subscribed`,
      { body: tier.name, linkUrl: "/wallet" }
    );

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

// Access remains until current expiry, same as any real subscription
// product — this only stops future renewal, it doesn't revoke anything
// immediately. Idempotent: cancelling an already-cancelled/expired
// subscription is a no-op, not an error, since a double-click shouldn't
// surface as a failure.
export async function cancelSubscription(subscriberId: string, subscriptionId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE subscriptions SET status = 'cancelled'
     WHERE id = $1 AND subscriber_id = $2 AND status IN ('active', 'payment_failed')`,
    [subscriptionId, subscriberId]
  );
  if (!rowCount) {
    const exists = await pool.query(`SELECT 1 FROM subscriptions WHERE id = $1 AND subscriber_id = $2`, [
      subscriptionId,
      subscriberId,
    ]);
    if (!exists.rows[0]) throw new AppError(404, "Subscription not found");
  }
}

export async function listMySubscriptions(subscriberId: string): Promise<MySubscription[]> {
  const { rows } = await pool.query<{
    id: string;
    creator_id: string;
    username: string;
    display_name: string;
    tier_name: string;
    price_santim: number;
    status: MySubscription["status"];
    expires_at: string;
  }>(
    `SELECT s.id, s.creator_id, u.username, u.display_name,
            t.name AS tier_name, t.price_santim, s.status, s.expires_at
     FROM subscriptions s
     JOIN users u ON u.id = s.creator_id
     JOIN subscription_tiers t ON t.id = s.tier_id
     WHERE s.subscriber_id = $1
     ORDER BY s.status = 'active' DESC, s.expires_at DESC`,
    [subscriberId]
  );
  return rows.map((row) => ({
    id: row.id,
    creatorId: row.creator_id,
    creatorUsername: row.username,
    creatorDisplayName: row.display_name,
    tierName: row.tier_name,
    priceSantim: row.price_santim,
    status: row.status,
    expiresAt: row.expires_at,
  }));
}

// Daily renewal job (see server.ts for the interval that calls it). Picks
// up both 'active' subscriptions whose period just ended AND
// 'payment_failed' ones still inside their one-cycle grace period — a
// second consecutive failure is what actually cancels, matching how real
// subscription systems don't cancel on a single missed payment. Each
// subscription is processed independently so one failure (insufficient
// balance, a deleted creator profile, etc.) can't stop the rest of the
// batch, same reasoning as reapStaleStreams.
export async function renewSubscriptions(): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    subscriber_id: string;
    creator_id: string;
    price_santim: number;
    status: "active" | "payment_failed";
  }>(
    `SELECT s.id, s.subscriber_id, s.creator_id, t.price_santim, s.status
     FROM subscriptions s
     JOIN subscription_tiers t ON t.id = s.tier_id
     WHERE s.status IN ('active', 'payment_failed') AND s.expires_at < now()`
  );

  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ledgerTransactionId = await chargeSubscriptionOrNull(
        client,
        row.subscriber_id,
        row.creator_id,
        row.price_santim
      );
      if (ledgerTransactionId) {
        await client.query(
          `UPDATE subscriptions SET status = 'active', ledger_transaction_id = $1, expires_at = now() + interval '1 month'
           WHERE id = $2`,
          [ledgerTransactionId, row.id]
        );
        console.log(`[subscriptions] renewed ${row.id}`);
        await notify(row.subscriber_id, "subscription_renewed", "Your subscription renewed", {
          linkUrl: "/wallet",
        });
      } else if (row.status === "active") {
        // First miss: start the grace period. expires_at is left as-is
        // (already in the past) so tomorrow's run picks this row up again.
        await client.query(`UPDATE subscriptions SET status = 'payment_failed' WHERE id = $1`, [row.id]);
        console.log(`[subscriptions] payment failed, grace period started for ${row.id}`);
      } else {
        // Already in the grace period and failed again — cancel for real.
        await client.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [row.id]);
        console.log(`[subscriptions] cancelled ${row.id} after grace period`);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[subscriptions] failed processing ${row.id}:`, err);
    } finally {
      client.release();
    }
  }
}

interface SubscriptionAdminRow {
  id: string;
  subscriber_username: string;
  creator_username: string;
  tier_name: string;
  price_santim: number;
  status: SubscriptionAdminItem["status"];
  expires_at: string;
}

function mapAdminRow(row: SubscriptionAdminRow): SubscriptionAdminItem {
  return {
    id: row.id,
    subscriberUsername: row.subscriber_username,
    creatorUsername: row.creator_username,
    tierName: row.tier_name,
    priceSantim: row.price_santim,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

// filters.atRisk narrows to the payment_failed grace-period rows — the
// ones about to lapse if the next renewal attempt also fails, so support
// can proactively reach out if that's ever a priority (per the doc).
export async function listSubscriptionsForAdmin(filters: { atRisk?: boolean }): Promise<SubscriptionAdminItem[]> {
  const { rows } = await pool.query<SubscriptionAdminRow>(
    `SELECT s.id, su.username AS subscriber_username, cu.username AS creator_username,
            t.name AS tier_name, t.price_santim, s.status, s.expires_at
     FROM subscriptions s
     JOIN users su ON su.id = s.subscriber_id
     JOIN users cu ON cu.id = s.creator_id
     JOIN subscription_tiers t ON t.id = s.tier_id
     WHERE ($1::boolean IS NOT TRUE AND s.status = 'active') OR ($1::boolean IS TRUE AND s.status = 'payment_failed')
     ORDER BY s.expires_at ASC
     LIMIT 200`,
    [filters.atRisk ?? false]
  );
  return rows.map(mapAdminRow);
}

// Support/dispute case: gives a subscriber more time before the grace
// period's second-failure cancellation would otherwise trigger — pushes
// expires_at out without charging anything, distinct from a real renewal.
export async function extendGracePeriod(adminId: string, subscriptionId: string, days: number): Promise<void> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM subscriptions WHERE id = $1`, [
    subscriptionId,
  ]);
  if (!rows[0]) throw new AppError(404, "Subscription not found");
  if (rows[0].status !== "payment_failed") throw new AppError(400, "Only a payment_failed subscription has a grace period to extend");

  await pool.query(`UPDATE subscriptions SET expires_at = now() + interval '1 day' * $1 WHERE id = $2`, [
    days,
    subscriptionId,
  ]);
  await logAdminAction(adminId, "subscription.extend_grace", "subscription", subscriptionId, {
    metadata: { days },
  });
}

export async function forceCancelSubscription(adminId: string, subscriptionId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE subscriptions SET status = 'cancelled' WHERE id = $1 AND status IN ('active', 'payment_failed')`,
    [subscriptionId]
  );
  if (!rowCount) throw new AppError(404, "Subscription not found or already cancelled");
  await logAdminAction(adminId, "subscription.force_cancel", "subscription", subscriptionId);
}
