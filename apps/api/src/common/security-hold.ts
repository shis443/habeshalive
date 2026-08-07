import { pool } from "./db.js";

// Module 1.3 — a real, mandatory 72h pause on withdrawals right after a
// security-sensitive account change (password change, 2FA enabled/
// disabled). This is what stops an attacker who's just compromised an
// account (changed the password, maybe disabled the real owner's 2FA)
// from immediately draining the wallet before the owner notices — the
// account.deletion-style grace period pattern already in this codebase
// (auth/account-deletion-service.ts), applied to payouts instead.
//
// "Payout-details changes" from the original spec is deliberately not a
// distinct event type here: this codebase has no persisted "payout
// destination" on a user profile to change — requestPayout takes a
// destination account/bank per request (see wallet/service.ts's
// RequestPayoutInput) rather than storing one, so there's nothing to
// diff a "change" against.
export type SecurityEventType = "password_change" | "totp_enabled" | "totp_disabled";

const HOLD_DURATION_MS = 72 * 60 * 60 * 1000;

export async function recordSecurityEvent(userId: string, eventType: SecurityEventType): Promise<void> {
  await pool.query(`INSERT INTO security_events (user_id, event_type) VALUES ($1, $2)`, [userId, eventType]);
}

export interface ActiveSecurityHold {
  eventType: SecurityEventType;
  since: Date;
  until: Date;
}

// Null when there's no event in the last 72h — the common case. Reads the
// single most recent event only: an older, already-expired event can't
// extend a hold that a newer one hasn't already covered.
export async function getActiveSecurityHold(userId: string): Promise<ActiveSecurityHold | null> {
  const { rows } = await pool.query<{ event_type: SecurityEventType; created_at: string }>(
    `SELECT event_type, created_at FROM security_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;

  const since = new Date(row.created_at);
  const until = new Date(since.getTime() + HOLD_DURATION_MS);
  if (until.getTime() <= Date.now()) return null;

  return { eventType: row.event_type, since, until };
}
