import { pool } from "../common/db.js";

export interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

// Called once per successful login — all three session-issuing paths in
// routes.ts (password/OTP without 2FA, password/OTP after 2FA verify, and
// social auth) go through issueSessionToken below, which calls this first.
// The row this creates is what makes a JWT actually revocable: the token
// itself is a stateless, non-expiring credential (see app.ts's jwt.register
// and every reply.jwtSign call, none of which pass expiresIn for a real
// session token), so POST /auth/revoke-session works by revoking permission
// to use a specific jti, not by touching the token itself.
export async function createSession(userId: string, ip: string, userAgent: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sessions (user_id, ip_address, user_agent) VALUES ($1, $2, $3) RETURNING id`,
    [userId, ip, userAgent]
  );
  return rows[0]!.id;
}

// Touches last_seen_at and checks revocation in one round trip — called
// from app.ts's `authenticate` decorator on every authenticated request
// whose JWT carries a jti claim. A token issued before this feature shipped
// has no jti and skips this check entirely (grandfathered in, not silently
// logged out the moment this deploys).
export async function touchAndCheckSession(sessionId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [sessionId]
  );
  return rows.length > 0;
}

export async function listSessions(userId: string): Promise<Session[]> {
  const { rows } = await pool.query<{
    id: string;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    last_seen_at: string;
  }>(
    `SELECT id, ip_address, user_agent, created_at, last_seen_at
     FROM sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }));
}

// Scoped to the owning user in the WHERE clause — not just "does this
// session id exist" — so a user can never revoke someone else's session by
// guessing/enumerating ids. Returns false both when the id doesn't exist
// and when it belongs to another user, deliberately not distinguishing the
// two in the response (same reasoning as any owner-scoped lookup elsewhere
// in this codebase — see e.g. moderation's assertCanModerateStream).
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`,
    [sessionId, userId]
  );
  return rows.length > 0;
}
