import { randomBytes, randomUUID } from "node:crypto";
import { encryptSecret } from "../common/crypto.js";
import { pool } from "../common/db.js";
import { creditCreatorFromViewerSpend, getPlatformWalletId } from "../common/ledger.js";
import { clearDueEarningHolds } from "../wallet/earning-holds-service.js";

export interface TestUser {
  id: string;
  walletId: string;
  username: string;
}

async function createUserWithWallet(prefix: string): Promise<TestUser> {
  const suffix = randomBytes(4).toString("hex");
  const phone = `+2519${suffix.slice(0, 8)}`.padEnd(13, "0").slice(0, 13);
  const username = `${prefix}_${suffix}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (phone_number, username, display_name, is_verified)
       VALUES ($1, $2, $3, TRUE) RETURNING id`,
      [phone, username, `${prefix} ${suffix}`]
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
    return { id: userId, walletId, username };
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
  // Encrypted at rest, matching real production behavior (streams/
  // service.ts's ensureCreatorProfile) — a test fixture that stored
  // plaintext here would silently stop being representative the moment
  // encryption shipped, and any test asserting on the raw column's shape
  // (streams/service.test.ts's stream-key-encryption suite) would test
  // the fixture's shortcut, not reality.
  const streamKey = randomBytes(16).toString("hex");

  await pool.query(
    `INSERT INTO creator_profiles (user_id, stream_key, revenue_share_bps) VALUES ($1, $2, $3)`,
    [user.id, encryptSecret(streamKey), revenueShareBps]
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

// Gives a creator real, withdrawable ("cleared") earnings for tests that
// need a payout precondition (reserveFunds/requestPayout et al.) — routed
// through the actual production credit path (creditCreatorFromViewerSpend)
// and the actual clearing job (clearDueEarningHolds), not a hand-rolled
// SQL model of them, per this project's standing rule that an enforcement
// control's test must observe the real system. clearsInMs: 0 is the one
// deliberate shortcut — it lets the test collapse the real 14-day hold
// into an immediate clear without faking the clock, since
// creditCreatorFromViewerSpend already accepts this as a real parameter
// (not a test-only branch) for exactly this purpose.
//
// Funds a synthetic viewer wallet directly via wallet_balances_cache
// (bypassing topup/Chapa, which isn't what's under test here) and credits
// 100% of amountSantim to the creator as "paid" bucket, 0% to the
// platform, so the full amount clears and is fully withdrawable.
//
// Returns the synthetic viewer's user id — the caller must feed it into
// the same cleanupTestUsers(createdUserIds) call the test already makes
// for the creator. Deliberately does no cleanup of its own: the ledger
// balance trigger (migration 0048) is deferred per-statement, so deleting
// only the viewer's half of this transaction's entries in an isolated
// statement would delete an unbalanced remainder and raise at commit.
// cleanupTestUsers already deletes a whole ledger_transaction's entries
// in one statement (it discovers the transaction via the creator's own
// wallet, which is in the same tracked id list) — that's the only safe
// way to remove these rows, and it's already exactly what the existing
// gift/donation/PPV tests rely on for the identical reason.
export async function fundCreatorEarnings(creatorId: string, amountSantim: number): Promise<string> {
  const viewer = await createUserWithWallet("earnings_source");
  await pool.query(`UPDATE wallet_balances_cache SET balance_santim = $2 WHERE wallet_id = $1`, [
    viewer.walletId,
    amountSantim,
  ]);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const platformWalletId = await getPlatformWalletId(client);
    const { rows: walletRows } = await client.query<{ id: string }>(
      `SELECT id FROM wallets WHERE owner_type = 'user' AND owner_id = $1 AND currency = 'ETB'`,
      [creatorId]
    );
    const creatorWalletId = walletRows[0]!.id;
    const { rows: txRows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('gift', 'completed', now()) RETURNING id`
    );
    await creditCreatorFromViewerSpend(client, {
      ledgerTransactionId: txRows[0]!.id,
      viewerWalletId: viewer.walletId,
      creatorId,
      creatorWalletId,
      platformWalletId,
      totalAmount: amountSantim,
      creatorShare: amountSantim,
      platformShare: 0,
      clearsInMs: 0,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await clearDueEarningHolds();
  return viewer.id;
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
  //
  // admin_actions is append-only in production (migration 0057) — the one
  // bypass is a session-local GUC, which SET LOCAL scopes to a single
  // transaction. It must be a dedicated client with an explicit
  // BEGIN/COMMIT: pool.query() can hand two separate calls two different
  // physical connections from the pool, and SET LOCAL on the wrong one
  // would silently do nothing (or, with a plain session-level SET instead
  // of SET LOCAL, worse — leak the bypass to a later, unrelated query that
  // happens to reuse the same pooled connection).
  const cleanupClient = await pool.connect();
  try {
    await cleanupClient.query("BEGIN");
    await cleanupClient.query(`SET LOCAL app.allow_admin_actions_delete = 'on'`);
    await cleanupClient.query(`DELETE FROM admin_actions WHERE actor_id = ANY($1)`, [userIds]);
    await cleanupClient.query("COMMIT");
  } catch (err) {
    await cleanupClient.query("ROLLBACK");
    throw err;
  } finally {
    cleanupClient.release();
  }
  // Also no CASCADE from users (0001_init.sql — actor_id/target_user_id
  // both plain REFERENCES) — surfaced by actions-service.test.ts, the
  // first test coverage banUser/unbanUser ever had.
  await pool.query(`DELETE FROM moderation_actions WHERE actor_id = ANY($1) OR target_user_id = ANY($1)`, [
    userIds,
  ]);
  // Also no CASCADE from users on reviewed_by (0032_kyc.sql) — user_id
  // itself does cascade, so a row is already gone by the time the final
  // DELETE FROM users below runs if user_id was one of ours; this only
  // needs to catch rows an admin (also one of ours) reviewed for some
  // OTHER, non-test user. Surfaced by kyc/service.test.ts's first
  // coverage of approveKyc.
  await pool.query(`DELETE FROM kyc_submissions WHERE reviewed_by = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM gifter_badges WHERE user_id = ANY($1) OR creator_id = ANY($1)`, [userIds]);
  // Also no CASCADE from users, same reasoning as gifter_badges above —
  // 0025_gursha_gift_economy.sql's user_ranks/platform_subscriptions.
  await pool.query(`DELETE FROM user_ranks WHERE user_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM platform_subscriptions WHERE subscriber_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM gifts_sent WHERE sender_id = ANY($1) OR creator_id = ANY($1)`, [userIds]);
  // Also no CASCADE from users on ledger_transaction_id (0033_donations_
  // and_ppv.sql) — same reasoning as gifts_sent above, first surfaced by
  // wallet/service.test.ts's sendDonation coverage and streams/
  // ppv-service.test.ts's purchasePpvAccess coverage.
  await pool.query(`DELETE FROM donations WHERE donor_id = ANY($1) OR creator_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM ppv_purchases WHERE buyer_id = ANY($1)`, [userIds]);
  // Before payouts and ledger_entries below — earning_holds.ledger_entry_id
  // and .consumed_by_payout_id both reference them with no ON DELETE
  // CASCADE (db/migrations/0053_wallet_buckets_and_clearing.sql), so
  // deleting either first would fail this creator's FK constraint the
  // first time a test actually exercises a viewer-funded credit path.
  await pool.query(`DELETE FROM earning_holds WHERE creator_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM payouts WHERE creator_id = ANY($1)`, [userIds]);
  // payout_batches.prepared_by/approved_by have no CASCADE from users
  // (0061_payout_batches.sql) — deleted after payouts above, since
  // payouts.batch_id -> payout_batches has no CASCADE either and would
  // otherwise block this. Surfaced by admin/payout-batches-service.test.ts
  // (T7).
  await pool.query(`DELETE FROM payout_batches WHERE prepared_by = ANY($1) OR approved_by = ANY($1)`, [userIds]);
  // payout_instruments.verified_by and creator_tax_profiles.reviewed_by
  // (0060_tax_profiles_and_payout_instruments.sql) also have no CASCADE
  // from users — creator_id on both DOES cascade, but relying on that
  // alone races with the final DELETE FROM users below: a single
  // multi-row DELETE doesn't guarantee a creator's cascade fires before
  // an admin's own "still referenced" check runs for the SAME statement
  // (confirmed by direct reproduction — Postgres processes per-row FK
  // triggers in scan order, not creator-before-admin order), so a test's
  // own verifying admin can trip this even though their creator is in the
  // very same cleanup batch. Explicit delete here sidesteps the race
  // entirely, same fix shape as kyc_submissions.reviewed_by below.
  await pool.query(`DELETE FROM payout_instruments WHERE creator_id = ANY($1) OR verified_by = ANY($1)`, [
    userIds,
  ]);
  await pool.query(`DELETE FROM creator_tax_profiles WHERE creator_id = ANY($1) OR reviewed_by = ANY($1)`, [
    userIds,
  ]);
  // Also no CASCADE from users on chat_messages.user_id (0001_init.sql —
  // only stream_id cascades) — surfaced by chat/service.test.ts's first
  // coverage of sendChatMessage/deleteChatMessage.
  await pool.query(`DELETE FROM chat_messages WHERE user_id = ANY($1)`, [userIds]);
  // channel_blocks.creator_id/blocked_user_id both cascade (0036_
  // channel_mods_and_multiscript.sql) but blocked_by doesn't — surfaced by
  // channel-mods-service.test.ts's "granted moderator blocks a viewer"
  // case, where the moderator (blocked_by) is cleaned up in the same batch
  // as the creator and target.
  await pool.query(
    `DELETE FROM channel_blocks WHERE creator_id = ANY($1) OR blocked_user_id = ANY($1) OR blocked_by = ANY($1)`,
    [userIds]
  );
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
