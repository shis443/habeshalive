import type { AccountDeletionStatus } from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { getBalance } from "../wallet/service.js";
import { verifyPasswordHash } from "./password.js";
import { consumeOtp, requestEmailOtp, requestOtp } from "./service.js";

// [CONFIRM] default: 30-day grace period — logging back in during this
// window cancels the deletion (see clearPendingDeletion, called from
// every login-completing path in service.ts).
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60_000;

// Reuses the same phone/email-keyed otp_codes table + consumeOtp the
// login flow already uses, rather than a second, separately-reliable OTP
// mechanism — the account being deleted already owns this phone/email, so
// proving a fresh code was received on it is exactly as strong a
// re-authentication as the login flow's own OTP step.
export async function requestAccountDeletionOtp(userId: string): Promise<void> {
  const { rows } = await pool.query<{ phone_number: string | null; email: string | null }>(
    `SELECT phone_number, email FROM users WHERE id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "User not found");
  if (!row.phone_number && !row.email) {
    throw new AppError(400, "No phone number or email on file to verify against");
  }

  if (row.phone_number) await requestOtp(row.phone_number);
  else await requestEmailOtp(row.email!);
}

async function assertReauthenticated(userId: string, password?: string, code?: string): Promise<void> {
  const { rows } = await pool.query<{ password_hash: string | null; phone_number: string | null; email: string | null }>(
    `SELECT password_hash, phone_number, email FROM users WHERE id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "User not found");

  if (row.password_hash) {
    if (!password || !verifyPasswordHash(password, row.password_hash)) {
      throw new AppError(401, "Incorrect password");
    }
    return;
  }

  if (!code) throw new AppError(400, "Request a verification code first");
  if (row.phone_number) await consumeOtp({ phoneNumber: row.phone_number }, code);
  else if (row.email) await consumeOtp({ email: row.email }, code);
  else throw new AppError(400, "No phone number or email on file to verify against");
}

async function assertNoDeletionBlockers(userId: string): Promise<void> {
  const { balanceSantim } = await getBalance(userId);
  if (balanceSantim > 0) {
    throw new AppError(400, "Withdraw your wallet balance before deleting your account");
  }

  const { rows: payoutRows } = await pool.query(
    `SELECT 1 FROM payouts WHERE creator_id = $1 AND status IN ('pending_review', 'processing') LIMIT 1`,
    [userId]
  );
  if (payoutRows.length > 0) {
    throw new AppError(400, "You have a payout in progress — wait for it to complete before deleting your account");
  }

  const { rows: subRows } = await pool.query(
    `SELECT 1 FROM subscriptions WHERE creator_id = $1 AND status = 'active' LIMIT 1`,
    [userId]
  );
  if (subRows.length > 0) {
    throw new AppError(
      400,
      "You still have active subscribers — they need to be resolved before you can delete your creator account"
    );
  }
}

export async function requestAccountDeletion(
  userId: string,
  input: { password?: string; code?: string }
): Promise<AccountDeletionStatus> {
  await assertReauthenticated(userId, input.password, input.code);
  await assertNoDeletionBlockers(userId);

  const { rows } = await pool.query<{ deletion_requested_at: string }>(
    `UPDATE users SET deletion_requested_at = now() WHERE id = $1 RETURNING deletion_requested_at`,
    [userId]
  );
  const requestedAt = rows[0]!.deletion_requested_at;
  return {
    deletionRequestedAt: requestedAt,
    gracePeriodEndsAt: new Date(new Date(requestedAt).getTime() + GRACE_PERIOD_MS).toISOString(),
  };
}

export async function getAccountDeletionStatus(userId: string): Promise<AccountDeletionStatus> {
  const { rows } = await pool.query<{ deletion_requested_at: string | null }>(
    `SELECT deletion_requested_at FROM users WHERE id = $1`,
    [userId]
  );
  const requestedAt = rows[0]?.deletion_requested_at ?? null;
  return {
    deletionRequestedAt: requestedAt,
    gracePeriodEndsAt: requestedAt ? new Date(new Date(requestedAt).getTime() + GRACE_PERIOD_MS).toISOString() : null,
  };
}

export async function cancelAccountDeletion(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET deletion_requested_at = NULL WHERE id = $1`, [userId]);
}

// Called from every login-completing path (verifyOtp, verifyEmailOtp,
// login, social auth) — "logging back in during the grace period cancels
// the deletion" per E.8. Cheap no-op for the overwhelming majority of
// logins (deletion_requested_at is NULL), so it's fine to call
// unconditionally rather than checking first.
export async function clearPendingDeletion(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET deletion_requested_at = NULL WHERE id = $1 AND deletion_requested_at IS NOT NULL`, [
    userId,
  ]);
}

// Reaper (periodic job, see server.ts) — anonymizes accounts whose grace
// period has elapsed. Ledger entries, gifts_sent, subscriptions, payouts,
// and streams are NEVER touched: the whole point of anonymizing instead
// of hard-deleting the users row is that financial history must stay
// intact (ledger_entries.wallet_id and every other FK pointing at this
// user keeps resolving correctly, just to a tombstoned identity). Chat
// messages, follows, and notifications are the only things actually
// hard-deleted, per E.8's explicit distinction between "financial record"
// and "everything else."
export async function processAccountDeletions(): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM users
     WHERE deletion_requested_at IS NOT NULL
       AND deletion_requested_at < now() - interval '30 days'
       AND anonymized_at IS NULL`
  );

  for (const { id } of rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE users SET
           display_name = 'Deleted user',
           username = 'deleted_' || substr(id::text, 1, 8),
           bio = NULL,
           avatar_url = NULL,
           phone_number = NULL,
           email = NULL,
           pending_phone_number = NULL,
           pending_email = NULL,
           password_hash = NULL,
           anonymized_at = now(),
           updated_at = now()
         WHERE id = $1`,
        [id]
      );
      await client.query(`DELETE FROM chat_messages WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM follows WHERE follower_id = $1 OR creator_id = $1`, [id]);
      await client.query(`DELETE FROM notifications WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM social_accounts WHERE user_id = $1`, [id]);
      // VODs would delete from object storage here too — no-op today:
      // VOD_S3_* credentials aren't configured yet (see streams/routes.ts's
      // comment on the vod-ready webhook never having fired in production),
      // so there's no real bucket to delete from. Flagged as a genuine
      // follow-up once object storage is wired, not silently skipped.
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[account-deletion] failed anonymizing ${id}:`, err);
    } finally {
      client.release();
    }
  }

  return rows.length;
}
