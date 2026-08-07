import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret } from "../common/crypto.js";
import { AppError } from "../common/errors.js";
import { pool } from "../common/db.js";
import { recordSecurityEvent } from "../common/security-hold.js";
import { emailGateway } from "./email-gateway.js";
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from "./totp.js";

interface TotpRow {
  secret_encrypted: string;
  enabled: boolean;
}

export async function getTotpStatus(userId: string): Promise<{ enabled: boolean }> {
  const { rows } = await pool.query<TotpRow>(`SELECT enabled FROM user_totp WHERE user_id = $1`, [userId]);
  return { enabled: rows[0]?.enabled ?? false };
}

// Real, internal use only (login-flow gate) — never exposed over a route,
// same "server decides, client just supplies a code" boundary as every
// other auth check in this file.
export async function isTotpEnabled(userId: string): Promise<boolean> {
  return (await getTotpStatus(userId)).enabled;
}

// Generates a fresh secret and stores it *disabled* — calling this again
// before /2fa/confirm just overwrites the still-pending secret (e.g. the
// user re-scans because the first QR didn't load), harmless since nothing
// trusts an unconfirmed secret for anything yet.
export async function setupTotp(userId: string, accountLabel: string): Promise<{ secret: string; otpauthUri: string }> {
  const secret = generateTotpSecret();
  await pool.query(
    `INSERT INTO user_totp (user_id, secret_encrypted, enabled, confirmed_at)
     VALUES ($1, $2, false, NULL)
     ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = $2, enabled = false, confirmed_at = NULL`,
    [userId, encryptSecret(secret)]
  );
  return { secret, otpauthUri: buildOtpauthUri(secret, accountLabel) };
}

// The one place a pending secret actually gets trusted for anything — a
// real, currently-valid code proves the secret made it into a real
// authenticator app, not just that the user clicked "I scanned it."
export async function confirmTotp(userId: string, code: string): Promise<void> {
  const { rows } = await pool.query<TotpRow>(
    `SELECT secret_encrypted, enabled FROM user_totp WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw new AppError(400, "No pending 2FA setup — call /2fa/setup first");
  if (row.enabled) throw new AppError(400, "2FA is already enabled");

  const secret = decryptSecret(row.secret_encrypted);
  if (!verifyTotpCode(secret, code)) throw new AppError(400, "Invalid code");

  await pool.query(`UPDATE user_totp SET enabled = true, confirmed_at = now() WHERE user_id = $1`, [userId]);
  await recordSecurityEvent(userId, "totp_enabled");
}

// Requires a real current code, not just an authenticated session — 2FA
// existing specifically to raise the bar past "has the session cookie"
// would be pointless if turning it back off didn't require the same bar.
export async function disableTotp(userId: string, code: string): Promise<void> {
  const { rows } = await pool.query<TotpRow>(
    `SELECT secret_encrypted, enabled FROM user_totp WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row?.enabled) throw new AppError(400, "2FA is not enabled");

  const secret = decryptSecret(row.secret_encrypted);
  if (!verifyTotpCode(secret, code)) throw new AppError(400, "Invalid code");

  await pool.query(`DELETE FROM user_totp WHERE user_id = $1`, [userId]);
  await recordSecurityEvent(userId, "totp_disabled");
}

// Login-flow use — verifies a submitted code against the user's real,
// *enabled* secret. Returns false (not a throw) for "not enabled" or
// "no such user" so callers can fold this into a single boolean gate
// without a try/catch, same convention as timingSafeEqualStreamKey.
export async function verifyTotpForLogin(userId: string, code: string): Promise<boolean> {
  const { rows } = await pool.query<TotpRow>(
    `SELECT secret_encrypted, enabled FROM user_totp WHERE user_id = $1 AND enabled = true`,
    [userId]
  );
  const row = rows[0];
  if (!row) return false;
  return verifyTotpCode(decryptSecret(row.secret_encrypted), code);
}

// IP + User-Agent hash — see db/migrations/0030's own comment on why this
// is the honest, server-only version of "device fingerprinting" (not
// canvas/font/WebGL fingerprinting, which needs frontend instrumentation
// this pass doesn't add).
export function computeDeviceFingerprint(ip: string, userAgent: string): string {
  return createHash("sha256").update(`${ip}|${userAgent}`).digest("hex");
}

// Called once per successful full login (after 2FA, if enabled — see
// routes.ts) — records the event and, if this exact IP+UA combination has
// never logged in as this user before, emails a "new login" notice. Only
// ever sent by email (real, via Resend — see email-gateway.ts); SMS stays
// stub-only in this codebase, so a phone-only user with no email on file
// silently doesn't get one rather than this throwing.
export async function recordLoginAndNotifyIfNewDevice(
  userId: string,
  ip: string,
  userAgent: string
): Promise<void> {
  const fingerprint = computeDeviceFingerprint(ip, userAgent);
  const existing = await pool.query(
    `SELECT 1 FROM login_events WHERE user_id = $1 AND device_fingerprint = $2 LIMIT 1`,
    [userId, fingerprint]
  );
  const isNewDevice = existing.rows.length === 0;

  await pool.query(
    `INSERT INTO login_events (user_id, ip_address, user_agent, device_fingerprint) VALUES ($1, $2, $3, $4)`,
    [userId, ip, userAgent, fingerprint]
  );

  if (!isNewDevice) return;

  const { rows } = await pool.query<{ email: string | null }>(`SELECT email FROM users WHERE id = $1`, [userId]);
  const email = rows[0]?.email;
  if (!email) return;

  await emailGateway.sendNewDeviceLogin(email, { ip, userAgent }).catch((err) => {
    // Best-effort — a failed notification email must never block or
    // unwind an otherwise-successful login.
    console.error(`[auth] failed to send new-device login email to user ${userId}:`, err);
  });
}

// Short-lived pending-2FA token shape — a real login-flow state machine
// needs *some* way to carry "this identifier already proved their
// password/OTP, still owes a TOTP code" between two requests without
// re-sending the password. Signed with the same @fastify/jwt instance
// every other token in this app uses (simpler than adding a second,
// Redis-backed opaque-token mechanism just for this), but with a short
// expiresIn and a pending2fa marker — see app.ts's authenticate
// preHandler, which now explicitly rejects any token carrying this claim,
// so a pending token can never be used in place of a real session token
// against an authenticated route.
export interface PendingTotpClaims {
  sub: string;
  pending2fa: true;
}
