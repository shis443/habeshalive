import type { AuthUser, VerifyEmailOtpInput, VerifyOtpInput } from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { emailGateway } from "./email-gateway.js";
import { generateSixDigitCode, hashCode, verifyCodeHash } from "./otp.js";
import { smsGateway } from "./sms-gateway.js";

const RESEND_COOLDOWN_MS = 30_000;
const OTP_TTL_MS = 5 * 60_000;

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role as AuthUser["role"],
  };
}

export async function getUserById(userId: string): Promise<AuthUser> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, username, display_name, avatar_url, role FROM users WHERE id = $1`,
    [userId]
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
  displayName: string | undefined
): Promise<{ user: AuthUser }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing =
      "phoneNumber" in identity
        ? await client.query<UserRow>(
            `SELECT id, username, display_name, avatar_url, role FROM users WHERE phone_number = $1`,
            [identity.phoneNumber]
          )
        : await client.query<UserRow>(
            `SELECT id, username, display_name, avatar_url, role FROM users WHERE email = $1`,
            [identity.email]
          );

    let userRow = existing.rows[0];

    if (!userRow) {
      if (!username || !displayName) {
        throw new AppError(400, "username and displayName are required to create an account");
      }

      let inserted;
      try {
        inserted =
          "phoneNumber" in identity
            ? await client.query<UserRow>(
                `INSERT INTO users (phone_number, username, display_name, is_verified)
                 VALUES ($1, $2, $3, TRUE)
                 RETURNING id, username, display_name, avatar_url, role`,
                [identity.phoneNumber, username, displayName]
              )
            : await client.query<UserRow>(
                `INSERT INTO users (email, username, display_name, is_verified)
                 VALUES ($1, $2, $3, TRUE)
                 RETURNING id, username, display_name, avatar_url, role`,
                [identity.email, username, displayName]
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

export async function verifyOtp(input: VerifyOtpInput): Promise<{ user: AuthUser }> {
  const { rows } = await pool.query<{
    id: string;
    code_hash: string;
    expires_at: string;
    consumed_at: string | null;
  }>(
    `SELECT id, code_hash, expires_at, consumed_at FROM otp_codes
     WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1`,
    [input.phoneNumber]
  );

  const otp = rows[0];
  if (!otp) throw new AppError(400, "No code was requested for this number");
  if (otp.consumed_at) throw new AppError(400, "This code has already been used");
  if (new Date(otp.expires_at) < new Date()) throw new AppError(400, "This code has expired");
  if (!verifyCodeHash(input.code, otp.code_hash)) throw new AppError(400, "Incorrect code");

  await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);

  return findOrCreateUser({ phoneNumber: input.phoneNumber }, input.username, input.displayName);
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
  const { rows } = await pool.query<{
    id: string;
    code_hash: string;
    expires_at: string;
    consumed_at: string | null;
  }>(
    `SELECT id, code_hash, expires_at, consumed_at FROM otp_codes
     WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
    [input.email]
  );

  const otp = rows[0];
  if (!otp) throw new AppError(400, "No code was requested for this email");
  if (otp.consumed_at) throw new AppError(400, "This code has already been used");
  if (new Date(otp.expires_at) < new Date()) throw new AppError(400, "This code has expired");
  if (!verifyCodeHash(input.code, otp.code_hash)) throw new AppError(400, "Incorrect code");

  await pool.query(`UPDATE otp_codes SET consumed_at = now() WHERE id = $1`, [otp.id]);

  return findOrCreateUser({ email: input.email }, input.username, input.displayName);
}
