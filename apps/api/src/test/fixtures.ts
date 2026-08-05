import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../common/db.js";

export interface TestUser {
  id: string;
  walletId: string;
}

async function createUserWithWallet(prefix: string): Promise<TestUser> {
  const suffix = randomBytes(4).toString("hex");
  const phone = `+2519${suffix.slice(0, 8)}`.padEnd(13, "0").slice(0, 13);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (phone_number, username, display_name, is_verified)
       VALUES ($1, $2, $3, TRUE) RETURNING id`,
      [phone, `${prefix}_${suffix}`, `${prefix} ${suffix}`]
    );
    const userId = userResult.rows[0]!.id;

    const walletResult = await client.query<{ id: string }>(
      `INSERT INTO wallets (owner_type, owner_id, currency) VALUES ('user', $1, 'ETB') RETURNING id`,
      [userId]
    );
    const walletId = walletResult.rows[0]!.id;

    await client.query(`INSERT INTO wallet_balances_cache (wallet_id, balance_santim) VALUES ($1, 0)`, [
      walletId,
    ]);

    await client.query("COMMIT");
    return { id: userId, walletId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createTestViewer(): Promise<TestUser> {
  return createUserWithWallet("viewer");
}

export interface TestCreator extends TestUser {
  streamId: string;
}

export async function createTestCreator(revenueShareBps = 8000): Promise<TestCreator> {
  const user = await createUserWithWallet("creator");
  const streamKey = randomBytes(16).toString("hex");

  await pool.query(
    `INSERT INTO creator_profiles (user_id, stream_key, revenue_share_bps) VALUES ($1, $2, $3)`,
    [user.id, streamKey, revenueShareBps]
  );

  const streamResult = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, status, started_at) VALUES ($1, 'Test Stream', 'live', now()) RETURNING id`,
    [user.id]
  );

  return { ...user, streamId: streamResult.rows[0]!.id };
}

// db/migrations/0019_gursha.sql DELETEd the original Buna/Injera/Lion/Crown
// seed (different prices each) and replaced it with four same-priced
// "Mulmul" theme rows (2500 santim each) as part of the Gursha rebrand —
// found because the pre-existing test suite still referenced the deleted
// names and failed against a fully-migrated database (this repo has no git
// remote, so CI had never actually run to catch it).
// "Golden Mulmul"/"Berbere Mulmul"/"Holiday Mulmul" were retired (set
// is_active = FALSE, not deleted) by 0025_gursha_gift_economy.sql's
// re-priced catalog — kept in this union since the rows still exist and a
// test could deliberately want an inactive one (e.g. to verify sendGift
// rejects it), but sendGift itself will 404 on any of the three.
export async function getGiftTypeId(
  name:
    | "Classic Mulmul"
    | "Golden Mulmul"
    | "Berbere Mulmul"
    | "Holiday Mulmul"
    | "Jebena Buna"
    | "Sini Buna"
    | "Macchiato"
    | "Berele Tej"
    | "Filtered Tej"
    | "Special Kurt"
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM gift_types WHERE name = $1`, [name]);
  const row = rows[0];
  if (!row) throw new Error(`Gift type ${name} not seeded — run db:migrate`);
  return row.id;
}

// db/migrations/0003_subscriptions.sql seeds three global (not per-creator)
// tiers once, idempotently — same pattern as getGiftTypeId above.
export async function getSubscriptionTierId(name: "Tier 1" | "Tier 2" | "Tier 3"): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM subscription_tiers WHERE name = $1`, [name]);
  const row = rows[0];
  if (!row) throw new Error(`Subscription tier ${name} not seeded — run db:migrate`);
  return row.id;
}

export async function getWalletBalance(walletId: string): Promise<number> {
  const { rows } = await pool.query<{ balance_santim: number }>(
    `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1`,
    [walletId]
  );
  return rows[0]?.balance_santim ?? 0;
}

export async function assertTransactionBalanced(ledgerTransactionId: string): Promise<void> {
  const { rows } = await pool.query<{ direction: "debit" | "credit"; amount_santim: number }>(
    `SELECT direction, amount_santim FROM ledger_entries WHERE ledger_transaction_id = $1`,
    [ledgerTransactionId]
  );
  if (rows.length < 2) {
    throw new Error(`Transaction ${ledgerTransactionId} has fewer than 2 entries`);
  }
  const credits = rows.filter((r) => r.direction === "credit").reduce((sum, r) => sum + r.amount_santim, 0);
  const debits = rows.filter((r) => r.direction === "debit").reduce((sum, r) => sum + r.amount_santim, 0);
  if (credits !== debits) {
    throw new Error(`Transaction ${ledgerTransactionId} does not balance: credits=${credits} debits=${debits}`);
  }
}

export function uniqueTxRef(): string {
  return `topup_${randomUUID()}`;
}

export async function cleanupTestUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  // Gift transactions also leave an entry on the shared platform wallet, so
  // "owned by one of our test wallets" isn't enough to find every entry —
  // collect full transaction ids first via every path that can reach them.
  const { rows: txRows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT lt.id
     FROM ledger_transactions lt
     LEFT JOIN gifts_sent gs ON gs.ledger_transaction_id = lt.id
     LEFT JOIN payouts p ON p.ledger_transaction_id = lt.id
     LEFT JOIN streams s ON s.id = lt.stream_id
     WHERE gs.sender_id = ANY($1) OR gs.creator_id = ANY($1) OR p.creator_id = ANY($1) OR s.creator_id = ANY($1)
        OR lt.id IN (
          SELECT ledger_transaction_id FROM ledger_entries
          WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_type = 'user' AND owner_id = ANY($1))
        )`,
    [userIds]
  );
  const ledgerTransactionIds = txRows.map((r) => r.id);

  // subscriptions/gift_cards/stream_boosts have no ON DELETE CASCADE from
  // users (none of subscriber_id/creator_id/purchaser_id/redeemed_by
  // specify it) — added when test coverage for these paths was added, since
  // the final `DELETE FROM users` below would otherwise fail its FK
  // constraint the first time a test actually created one of these rows.
  await pool.query(`DELETE FROM subscriptions WHERE subscriber_id = ANY($1) OR creator_id = ANY($1)`, [userIds]);
  await pool.query(
    `DELETE FROM gift_cards WHERE purchaser_id = ANY($1) OR redeemed_by = ANY($1)`,
    [userIds]
  );
  await pool.query(`DELETE FROM stream_boosts WHERE creator_id = ANY($1)`, [userIds]);
  // Also no CASCADE from users — surfaced once a test actually exercised
  // an admin action (cancelBoost/cancelGiftCard, both call logAdminAction)
  // or sent more than one gift to the same creator (gifter_badges).
  await pool.query(`DELETE FROM admin_actions WHERE actor_id = ANY($1)`, [userIds]);
  // Also no CASCADE from users (0001_init.sql — actor_id/target_user_id
  // both plain REFERENCES) — surfaced by actions-service.test.ts, the
  // first test coverage banUser/unbanUser ever had.
  await pool.query(`DELETE FROM moderation_actions WHERE actor_id = ANY($1) OR target_user_id = ANY($1)`, [
    userIds,
  ]);
  await pool.query(`DELETE FROM gifter_badges WHERE user_id = ANY($1) OR creator_id = ANY($1)`, [userIds]);
  // Also no CASCADE from users, same reasoning as gifter_badges above —
  // 0025_gursha_gift_economy.sql's user_ranks/platform_subscriptions.
  await pool.query(`DELETE FROM user_ranks WHERE user_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM platform_subscriptions WHERE subscriber_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM gifts_sent WHERE sender_id = ANY($1) OR creator_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM payouts WHERE creator_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM ledger_entries WHERE ledger_transaction_id = ANY($1)`, [ledgerTransactionIds]);
  await pool.query(`DELETE FROM ledger_transactions WHERE id = ANY($1)`, [ledgerTransactionIds]);
  await pool.query(
    `DELETE FROM wallet_balances_cache WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_type = 'user' AND owner_id = ANY($1))`,
    [userIds]
  );
  await pool.query(`DELETE FROM wallets WHERE owner_type = 'user' AND owner_id = ANY($1)`, [userIds]);
  // streams and creator_profiles both have ON DELETE CASCADE from users
  // (confirmed in db/schema.sql) — no explicit delete needed for either.
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);

  // Deleting entries that belonged to the shared platform wallet leaves its
  // cache stale — reconcile it from the remaining entries (this is exactly
  // the periodic reconciliation the ledger design calls for).
  await pool.query(
    `UPDATE wallet_balances_cache
     SET balance_santim = COALESCE((
       SELECT SUM(CASE WHEN direction = 'credit' THEN amount_santim ELSE -amount_santim END)
       FROM ledger_entries WHERE wallet_id = wallet_balances_cache.wallet_id
     ), 0), updated_at = now()
     WHERE wallet_id = (SELECT id FROM wallets WHERE owner_type = 'platform' AND currency = 'ETB')`
  );
}
