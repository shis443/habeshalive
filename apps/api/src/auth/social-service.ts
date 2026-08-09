import type { AuthUser, LinkedSocialAccount, SocialProvider } from "@birq/shared";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../common/env.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

interface VerifiedIdentity {
  providerUserId: string;
  email: string | null;
}

// Real verification against each provider's own published JWKS — this is
// the part that works regardless of credentials, since Google/Apple's
// public keys need no secret to fetch. What's actually credential-blocked
// is env.GOOGLE_CLIENT_ID/APPLE_CLIENT_ID (see env.ts's comment) — without
// a real registered app, the `audience` check below has nothing correct
// to compare against, so this throws a clear "not configured" error
// rather than silently accepting a token meant for a different app.
async function verifyIdToken(provider: SocialProvider, idToken: string): Promise<VerifiedIdentity> {
  if (provider === "google") {
    if (!env.GOOGLE_CLIENT_ID) throw new AppError(501, "Google sign-in isn't configured on this server yet");
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.GOOGLE_CLIENT_ID,
    });
    if (!payload.sub) throw new AppError(401, "Invalid Google token");
    return { providerUserId: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
  }

  if (!env.APPLE_CLIENT_ID) throw new AppError(501, "Apple sign-in isn't configured on this server yet");
  const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
    issuer: "https://appleid.apple.com",
    audience: env.APPLE_CLIENT_ID,
  });
  if (!payload.sub) throw new AppError(401, "Invalid Apple token");
  // Apple's private relay addresses (*@privaterelay.appleid.com) are real,
  // usable email addresses for our purposes — Apple forwards mail sent to
  // them — so no special-casing needed here, just accept whatever email
  // claim is present (or none, if the user withheld it entirely).
  return { providerUserId: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
}

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

async function generateUniqueUsername(seed: string): Promise<string> {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20) || "user";
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${Math.floor(Math.random() * 100000)}`;
    const { rows } = await pool.query(`SELECT 1 FROM users WHERE username = $1`, [candidate]);
    if (rows.length === 0) return candidate;
  }
  throw new AppError(500, "Couldn't generate a unique username — try again");
}

// The one signup-time-only path Apple takes: the real name is only ever
// present in the *first* authorization response, sent by the client SDK
// alongside the ID token, never inside the token itself — see
// packages/shared/src/schemas/social.ts's comment on socialAuthSchema.
export async function socialAuth(
  provider: SocialProvider,
  idToken: string,
  fullName?: string
): Promise<{ user: AuthUser }> {
  const identity = await verifyIdToken(provider, idToken);

  const { rows: linked } = await pool.query<UserRow>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.role, u.show_sensitive_content
     FROM social_accounts sa JOIN users u ON u.id = sa.user_id
     WHERE sa.provider = $1 AND sa.provider_user_id = $2`,
    [provider, identity.providerUserId]
  );
  if (linked[0]) return { user: toAuthUser(linked[0]) };

  // Account-linking edge case (E.3): an email match against an existing
  // account is NOT auto-merged — that would let anyone who controls a
  // Google/Apple account with a guessed/known email silently take over an
  // existing password/OTP account. Require them to log in the existing
  // way first, then link explicitly via POST /auth/social/:provider/link.
  if (identity.email) {
    const { rows: emailMatch } = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [identity.email]);
    if (emailMatch.length > 0) {
      throw new AppError(
        409,
        "An account with this email already exists — log in with your existing method, then link this from Settings"
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const username = await generateUniqueUsername(fullName ?? identity.email?.split("@")[0] ?? "user");
    const displayName = fullName ?? username;

    const inserted = await client.query<UserRow>(
      `INSERT INTO users (email, username, display_name, is_verified)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id, username, display_name, avatar_url, role, show_sensitive_content`,
      [identity.email, username, displayName]
    );
    const userRow = inserted.rows[0]!;

    const wallet = await client.query<{ id: string }>(
      `INSERT INTO wallets (owner_type, owner_id, currency) VALUES ('user', $1, 'ETB') RETURNING id`,
      [userRow.id]
    );
    await client.query(`INSERT INTO wallet_balances_cache (wallet_id, balance_santim) VALUES ($1, 0)`, [
      wallet.rows[0]!.id,
    ]);
    await client.query(
      `INSERT INTO social_accounts (user_id, provider, provider_user_id, email) VALUES ($1, $2, $3, $4)`,
      [userRow.id, provider, identity.providerUserId, identity.email]
    );

    await client.query("COMMIT");
    return { user: toAuthUser(userRow) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function linkSocialAccount(userId: string, provider: SocialProvider, idToken: string): Promise<void> {
  const identity = await verifyIdToken(provider, idToken);
  try {
    await pool.query(
      `INSERT INTO social_accounts (user_id, provider, provider_user_id, email) VALUES ($1, $2, $3, $4)`,
      [userId, provider, identity.providerUserId, identity.email]
    );
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw new AppError(409, "That account is already linked to a different Birq account");
    }
    throw err;
  }
}

export async function listLinkedSocialAccounts(userId: string): Promise<LinkedSocialAccount[]> {
  const { rows } = await pool.query<{ provider: SocialProvider; email: string | null; linked_at: string }>(
    `SELECT provider, email, linked_at FROM social_accounts WHERE user_id = $1 ORDER BY linked_at`,
    [userId]
  );
  return rows.map((row) => ({ provider: row.provider, email: row.email, linkedAt: row.linked_at }));
}

// Blocked if this would leave the account with zero working auth methods
// — password, phone/email (both support OTP login), or another social
// account. Losing every one of those means permanently locking yourself
// out, not just losing one convenience.
export async function unlinkSocialAccount(userId: string, provider: SocialProvider): Promise<void> {
  const { rows } = await pool.query<{
    password_hash: string | null;
    phone_number: string | null;
    email: string | null;
    social_count: string;
  }>(
    `SELECT u.password_hash, u.phone_number, u.email,
            (SELECT count(*) FROM social_accounts WHERE user_id = u.id) AS social_count
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "User not found");

  const hasOtherMethod = !!row.password_hash || !!row.phone_number || !!row.email || Number(row.social_count) > 1;
  if (!hasOtherMethod) {
    throw new AppError(400, "Add a password, phone number, or email before unlinking your only sign-in method");
  }

  await pool.query(`DELETE FROM social_accounts WHERE user_id = $1 AND provider = $2`, [userId, provider]);
}
