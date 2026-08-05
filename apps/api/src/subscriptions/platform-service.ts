import type { PlatformSubscription, PlatformSubscriptionStatus } from "@habeshalive/shared";
import type { PoolClient } from "pg";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import { notify } from "../notifications/service.js";

// Platform-wide sliding-scale ad-free subscription (see
// db/migrations/0025_gursha_gift_economy.sql). Deliberately a separate
// module from subscriptions/service.ts, not a variant of it: the money
// flow is genuinely different (100% platform, no creator to revenue-
// share with, mirrors stream_boosts' split more than per-creator
// subscriptions'), and there's no creator_id at all in this table.

// Same "return null on insufficient balance, don't throw" contract as
// subscriptions/service.ts's chargeSubscriptionOrNull -- the renewal job
// needs to keep processing the rest of the batch on one subscriber's
// failed charge.
async function chargePlatformSubscriptionOrNull(
  client: PoolClient,
  subscriberId: string,
  amountSantim: number
): Promise<string | null> {
  const subscriberWalletId = await getUserWalletId(client, subscriberId);
  const platformWalletId = await getPlatformWalletId(client);

  const balanceResult = await client.query<{ balance_santim: number }>(
    `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
    [subscriberWalletId]
  );
  const balance = balanceResult.rows[0]?.balance_santim ?? 0;
  if (balance < amountSantim) return null;

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions (type, status, completed_at)
     VALUES ('platform_subscription', 'completed', now()) RETURNING id`
  );
  const ledgerTransactionId = rows[0]!.id;

  // Single-leg-to-platform, unlike gifts/creator-subscriptions' 3-leg
  // split -- there's no creator on the other end of this transaction.
  await insertEntry(client, ledgerTransactionId, subscriberWalletId, "debit", amountSantim);
  await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", amountSantim);

  await applyBalanceDelta(client, subscriberWalletId, -amountSantim);
  await applyBalanceDelta(client, platformWalletId, amountSantim);

  return ledgerTransactionId;
}

function toPlatformSubscription(row: {
  amount_santim: number;
  status: PlatformSubscriptionStatus;
  expires_at: string;
}): PlatformSubscription {
  return { amountSantim: row.amount_santim, status: row.status, expiresAt: row.expires_at };
}

// Handles both a fresh signup and "move the slider to a new amount" --
// the partial unique index on platform_subscriptions (subscriber_id)
// WHERE status IN ('active','payment_failed') means there's at most one
// such row per user, and this upserts into it rather than creating a
// second one. A change immediately charges the new amount and restarts
// the monthly cycle from now, same "regardless of the chosen amount"
// simplicity as the spec asks for -- not a prorated mid-cycle adjustment.
export async function subscribeToPlatform(subscriberId: string, amountSantim: number): Promise<PlatformSubscription> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ledgerTransactionId = await chargePlatformSubscriptionOrNull(client, subscriberId, amountSantim);
    if (!ledgerTransactionId) throw new AppError(400, "Insufficient balance");

    const { rows } = await client.query<{ amount_santim: number; status: PlatformSubscriptionStatus; expires_at: string }>(
      `INSERT INTO platform_subscriptions (ledger_transaction_id, subscriber_id, amount_santim, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 month')
       ON CONFLICT (subscriber_id) WHERE status IN ('active', 'payment_failed')
       DO UPDATE SET ledger_transaction_id = $1, amount_santim = $3, status = 'active', expires_at = now() + interval '1 month'
       RETURNING amount_santim, status, expires_at`,
      [ledgerTransactionId, subscriberId, amountSantim]
    );

    await client.query("COMMIT");

    await notify(subscriberId, "subscription_new", "Your Birq subscription is active", {
      body: "Ad-free viewing platform-wide, plus your Sub Shield in chat.",
      linkUrl: "/wallet",
    });

    return toPlatformSubscription(rows[0]!);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Idempotent, same reasoning as subscriptions/service.ts's
// cancelSubscription -- a double-click or a cancel with nothing active
// shouldn't surface as an error. Access remains until expires_at, not
// revoked immediately.
export async function cancelPlatformSubscription(subscriberId: string): Promise<void> {
  await pool.query(
    `UPDATE platform_subscriptions SET status = 'cancelled' WHERE subscriber_id = $1 AND status IN ('active', 'payment_failed')`,
    [subscriberId]
  );
}

export async function getMyPlatformSubscription(subscriberId: string): Promise<PlatformSubscription | null> {
  const { rows } = await pool.query<{ amount_santim: number; status: PlatformSubscriptionStatus; expires_at: string }>(
    `SELECT amount_santim, status, expires_at FROM platform_subscriptions
     WHERE subscriber_id = $1 AND status IN ('active', 'payment_failed')`,
    [subscriberId]
  );
  const row = rows[0];
  return row ? toPlatformSubscription(row) : null;
}

// Daily renewal job (see server.ts) -- same grace-period state machine as
// subscriptions/service.ts's renewSubscriptions: a first missed payment
// on an active sub starts a one-cycle grace period, a second consecutive
// failure while already in that grace period cancels for real. Each row
// processed independently so one subscriber's failure can't stop the
// rest of the batch.
export async function renewPlatformSubscriptions(): Promise<void> {
  const { rows } = await pool.query<{
    subscriber_id: string;
    amount_santim: number;
    status: "active" | "payment_failed";
  }>(
    `SELECT subscriber_id, amount_santim, status FROM platform_subscriptions
     WHERE status IN ('active', 'payment_failed') AND expires_at < now()`
  );

  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ledgerTransactionId = await chargePlatformSubscriptionOrNull(client, row.subscriber_id, row.amount_santim);
      if (ledgerTransactionId) {
        await client.query(
          `UPDATE platform_subscriptions SET status = 'active', ledger_transaction_id = $1, expires_at = now() + interval '1 month'
           WHERE subscriber_id = $2`,
          [ledgerTransactionId, row.subscriber_id]
        );
        console.log(`[platform-subscriptions] renewed for ${row.subscriber_id}`);
        await notify(row.subscriber_id, "subscription_renewed", "Your Birq subscription renewed", {
          linkUrl: "/wallet",
        });
      } else if (row.status === "active") {
        // First miss: start the grace period. expires_at is left in the
        // past so tomorrow's run picks this row up again.
        await client.query(`UPDATE platform_subscriptions SET status = 'payment_failed' WHERE subscriber_id = $1`, [
          row.subscriber_id,
        ]);
        console.log(`[platform-subscriptions] payment failed, grace period started for ${row.subscriber_id}`);
      } else {
        await client.query(`UPDATE platform_subscriptions SET status = 'cancelled' WHERE subscriber_id = $1`, [
          row.subscriber_id,
        ]);
        console.log(`[platform-subscriptions] cancelled for ${row.subscriber_id} after grace period`);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[platform-subscriptions] failed processing ${row.subscriber_id}:`, err);
    } finally {
      client.release();
    }
  }
}
