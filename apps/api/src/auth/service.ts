import type { AuthUser, VerifyEmailOtpInput, VerifyOtpInput } from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { emailGateway } from "./email-gateway.js";
import { generateSixDigitCode, hashCode, verifyCodeHash } from "./otp.js";
import { hashPassword, verifyPasswordHash } from "./password.js";
import { smsGateway } from "./sms-gateway.js";

const RESEND_COOLDOWN_MS = 30_000;
const OTP_TTL_MS = 5 * 60_000;

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  show_sensitive_content: boolean;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role as AuthUser["role"],
    showSensitiveContent: row.show_sensitive_content,
  };
}

export async function getUserById(userId: string): Promise<AuthUser> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, username, display_name, avatar_url, role, show_sensitive_content FROM users WHERE id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "User not found");
  return toAuthUser(row);
}

export async function updatePreferences(userId: string, showSensitiveContent: boolean): Promise<AuthUser> {
  const { rows } = await pool.query<UserRow>(
    `UPDATE users SET show_sensitive_content = $1 WHERE id = $2
     RETURNING id, username, display_name, avatar_url, role, show_sensitive_content`,
    [showSensitiveContent, userId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "User not found");
  return toAuthUser(row);
}

export async function requestOtp(phoneNumber: string): Promise<void> {
  const { rows } = await pool.query<{ created_at: string }>(
    `SELECT created_at FROM otp_codes WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1`,
    [phoneNumber]
  );

  const last = rows[0];
  if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_MS) {
    throw new AppError(429, "Please wait before requesting another code");
  }

  const code = generateSixDigitCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await pool.query(
    `INSERT INTO otp_codes (phone_number, code_hash, expires_at) VALUES ($1, $2, $3)`,
    [phoneNumber, codeHash, expiresAt]
  );

  await smsGateway.sendOtp(phoneNumber, code);
}

// Shared by both OTP flows below — finds the user for this phone
// number/email, or creates one (plus their wallet) if this is a new
// signup. Factored out specifically because it touches wallet
// provisioning: writing this twice (once per channel) would risk the two
// copies drifting on money-adjacent logic.
async function findOrCreateUser(
  identity: { phoneNumber: string } | { email: string },
  username: string | undefined,
  displayName: string | undefined,
  password: string | undefined
): Promise<{ user: AuthUser }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing =
      "phoneNumber" in identity
        ? await client.query<UserRow>(
            `SELECT id, username, display_name, avatar_url, role, show_sensitive_content FROM users WHERE phone_number = $1`,
            [identity.phoneNumber]
          )
        : await client.query<UserRow>(
            `SELECT id, username, display_name, avatar_url, role, show_sensitive_content FROM users WHERE email = $1`,
            [identity.email]
          );

    let userRow = existing.rows[0];

    if (!userRow) {
      // Password required together with username/displayName for new
      // accounts (not a separate later step) — an account created here
      // without one couldn't use POST /auth/login afterward, only OTP,
      // silently reintroducing the every-login-costs-an-SMS problem this
      // was built to get rid of.
      if (!username || !displayName || !password) {
        throw new AppError(400, "username, displayName, and password are required to create an account");
      }
      const passwordHash = hashPassword(password);

      let inserted;
      try {
        inserted =
          "phoneNumber" in identity
            ? await client.query<UserRow>(
                `INSERT INTO users (phone_number, username, display_name, password_hash, is_verified)
                 VALUES ($1, $2, $3, $4, TRUE)
                 RETURNING id, username, display_name, avatar_url, role, show_sensitive_content`,
                [identity.phoneNumber, username, displayName, passwordHash]
              )
            : await client.query<UserRow>(
                `INSERT INTO users (email, username, display_name, password_hash, is_verified)
                 VALUES ($1, $2, $3, $4, TRUE)
                 RETURNING id, username, display_name, avatar_url, role, show_sensitive_content`,
                [identity.email, username, displayName, passwordHash]
              );
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "23505") {
          throw new AppError(409, "Username is already taken");
        }
        throw err;
      }
      userRow = inserted.rows[0]!;

      const wallet = await client.query<{ id: string }>(
        `INSERT INTO wallets (owner_type, owner_id, currency) VALUES ('user', $1, 'ETB') RETURNING id`,
        [userRow.id]
      );
      await client.query(
        `INSERT INTO wallet_balances_cache (wallet_id, balance_santim) VALUES ($1, 0)`,
        [wallet.rows[0]!.id]
      );
    }

    await client.query("COMMIT");
    return { user: toAuthUser(userRow) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Shared by verifyOtp/verifyEmailOtp/resetPassword — the actual
// lookup-check-consume logic is identical for all three, only the column
// (and therefore whether this proves an existing account vs authorizes
// creating a new one) differs, which is the caller's concern, not this
// function's.
async function consumeOtp(identity: { phoneNumber: string } | { email: string }, code: string): Promise<void> {
  const { rows } =
    "phoneNumber" in identity
      ? await pool.query<{ id: string; code_hash: string; expires_at: string; consumed_at: string | null }>(
          `SELECT id, code_hash, expires_at, consumed_at FROM otp_codes
           WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1`,
          [identity.phoneNumber]
        )
      : await pool.query<{ id: string; code_hash: string; expires_at: string; consumed_at: string | null }>(
          `SELECT id, code_hash, expires_at, consumed_at FROM otp_codes
           WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
          [identity.email]
        );

  const otp = rows[0];
  const identifierLabel = "phoneNumber" in identity ? "number" : "email";
  if (!otp) throw new AppError(400, `No code was requested for this ${identifierLabel}`);
  if (otp.consumed_at) throw new AppError(400, "This code has already been used");
  if (new Date(otp.expires_at) < new Date()) throw new AppError(400, "This code has expired");
  if (!verifyCodeHash(code, otp.code_hash)) throw new AppError(400, "Incorrect code");

  await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);
}

export async function verifyOtp(input: VerifyOtpInput): Promise<{ user: AuthUser }> {
  await consumeOtp({ phoneNumber: input.phoneNumber }, input.code);
  return findOrCreateUser({ phoneNumber: input.phoneNumber }, input.username, input.displayName, input.password);
}

export async function requestEmailOtp(email: string): Promise<void> {
  const { rows } = await pool.query<{ created_at: string }>(
    `SELECT created_at FROM otp_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
    [email]
  );

  const last = rows[0];
  if (last && Date.now() - new Date(last.created_at).getTime() < RESEND_COOLDOWN_MS) {
    throw new AppError(429, "Please wait before requesting another code");
  }

  const code = generateSixDigitCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await pool.query(
    `INSERT INTO otp_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)`,
    [email, codeHash, expiresAt]
  );

  try {
    await emailGateway.sendOtp(email, code);
  } catch (err) {
    // Surface the real reason (e.g. Resend's sandbox-sender restriction)
    // instead of a bare "internal_server_error" — this exact case is what
    // sent someone testing this straight to asking "what happened?"
    // instead of seeing the actionable message Resend already gave us.
    const reason = err instanceof Error ? err.message : "unknown error";
    throw new AppError(502, `Couldn't send the code: ${reason}`);
  }
}

export async function verifyEmailOtp(input: VerifyEmailOtpInput): Promise<{ user: AuthUser }> {
  await consumeOtp({ email: input.email }, input.code);
  return findOrCreateUser({ email: input.email }, input.username, input.displayName, input.password);
}

// "shisousman@..." vs "+251911234567" — good enough to route a login
// attempt to the right lookup column; an identifier that matches neither
// shape just won't find a user either way, same end result as a dedicated
// format-validation error, without the extra code path.
function identifierToIdentity(identifier: string): { phoneNumber: string } | { email: string } {
  return identifier.includes("@") ? { email: identifier } : { phoneNumber: identifier };
}

export async function login(identifier: string, password: string): Promise<{ user: AuthUser }> {
  const identity = identifierToIdentity(identifier);
  const { rows } =
    "phoneNumber" in identity
      ? await pool.query<UserRow & { password_hash: string | null }>(
          `SELECT id, username, display_name, avatar_url, role, show_sensitive_content, password_hash FROM users WHERE phone_number = $1`,
          [identity.phoneNumber]
        )
      : await pool.query<UserRow & { password_hash: string | null }>(
          `SELECT id, username, display_name, avatar_url, role, show_sensitive_content, password_hash FROM users WHERE email = $1`,
          [identity.email]
        );

  const row = rows[0];
  // Same generic message whether the account doesn't exist or the
  // password's wrong — distinguishing them here would let an attacker
  // enumerate which phone numbers/emails have accounts at all.
  const invalidCredentials = () => new AppError(401, "Incorrect identifier or password");
  if (!row) throw invalidCredentials();
  if (!row.password_hash) {
    // A real, different case from "wrong password" (this account exists
    // but was never given one — e.g. created before this feature shipped,
    // or always used OTP-only login) — worth a distinct, actionable
    // message rather than folding it into the generic one above.
    throw new AppError(401, "This account doesn't have a password set yet — use 'Forgot password' to set one");
  }
  if (!verifyPasswordHash(password, row.password_hash)) throw invalidCredentials();

  return { user: toAuthUser(row) };
}

export async function requestPasswordReset(identifier: string): Promise<void> {
  const identity = identifierToIdentity(identifier);
  // Reuses the exact same OTP send path new-account signup uses — the
  // account-existence check happens later, in resetPassword, not here, for
  // the same enumeration reason as login()'s generic error above: a
  // "send OTP" call succeeding or failing shouldn't reveal whether an
  // account exists for this identifier.
  if ("phoneNumber" in identity) {
    await requestOtp(identity.phoneNumber);
  } else {
    await requestEmailOtp(identity.email);
  }
}

export async function resetPassword(identifier: string, code: string, newPassword: string): Promise<void> {
  const identity = identifierToIdentity(identifier);
  await consumeOtp(identity, code);

  const passwordHash = hashPassword(newPassword);
  const { rowCount } =
    "phoneNumber" in identity
      ? await pool.query(`UPDATE users SET password_hash = $1 WHERE phone_number = $2`, [
          passwordHash,
          identity.phoneNumber,
        ])
      : await pool.query(`UPDATE users SET password_hash = $1 WHERE email = $2`, [passwordHash, identity.email]);

  // The OTP was real and just got consumed above, but if it doesn't
  // actually match an account (a password reset requested for a
  // never-registered number/email), there's no user row to update —
  // consumeOtp alone can't catch that, since it only checks the OTP
  // itself, not whether an account exists for it.
  if (!rowCount) throw new AppError(404, "No account found for this identifier");
}
