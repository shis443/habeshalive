import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { env } from "../common/env.js";
import { redis } from "../common/redis.js";

// Auth gateway for browser-based remote control — see docs/architecture.md's
// "Remote control" section for the full design this backs. The streamer's
// real stream_key never reaches the browser: a caller who owns the
// streamer (or is a designated assistant) gets a short-lived, HMAC-signed,
// single-streamer ticket instead. relay.ts calls validateTicket() before
// bridging any assistant socket to a streamer's connection.

const TICKET_TTL_SECONDS = 300; // long enough to connect, short enough to matter
const TICKET_PREFIX = "rc:ticket:";

export type RemoteControlScope = "owner" | "assistant";

export interface TicketPayload {
  ticketId: string;
  // creator_profiles.user_id — NOT a separate stream-key/device id. See
  // this migration's own comment (0040_remote_control_assistants.sql) for
  // why: there's no separate stream-key table in this schema, the key
  // itself just lives on the creator_profiles row keyed by user_id.
  streamerId: string;
  userId: string;
  scope: RemoteControlScope;
  issuedAt: number;
}

function signTicket(ticketId: string): string {
  return createHmac("sha256", env.REMOTE_CONTROL_TICKET_SECRET).update(ticketId).digest("base64url");
}

/**
 * Verify the caller may control this streamer. Ownership (streamerId ===
 * the caller's own user_id, and they actually have a creator profile) is
 * the common case; remote_control_assistants covers the "my producer runs
 * the stream while I'm on camera" delegation.
 */
export async function resolveScope(userId: string, streamerId: string): Promise<RemoteControlScope | null> {
  if (userId === streamerId) {
    const { rowCount } = await pool.query(`SELECT 1 FROM creator_profiles WHERE user_id = $1`, [userId]);
    return rowCount && rowCount > 0 ? "owner" : null;
  }

  const { rowCount } = await pool.query(
    `SELECT 1 FROM remote_control_assistants
      WHERE assistant_user_id = $1 AND streamer_id = $2 AND revoked_at IS NULL`,
    [userId, streamerId]
  );
  return rowCount && rowCount > 0 ? "assistant" : null;
}

export interface MintedTicket {
  ticket: string;
  signature: string;
  expiresIn: number;
  scope: RemoteControlScope;
}

export async function mintTicket(userId: string, streamerId: string, scope: RemoteControlScope): Promise<MintedTicket> {
  const ticketId = randomBytes(32).toString("base64url");
  const payload: TicketPayload = { ticketId, streamerId, userId, scope, issuedAt: Date.now() };

  // ioredis positional-args form (not the {EX: n} object shape the
  // `redis` npm package uses) — see web-bridge-service.ts for the same
  // pattern already established in this codebase.
  await redis.set(`${TICKET_PREFIX}${ticketId}`, JSON.stringify(payload), "EX", TICKET_TTL_SECONDS);

  await logAdminAction(userId, "remote_control.ticket_issued", "streamer", streamerId, { metadata: { scope } });

  return { ticket: ticketId, signature: signTicket(ticketId), expiresIn: TICKET_TTL_SECONDS, scope };
}

export async function logTicketDenied(userId: string, streamerId: string): Promise<void> {
  await logAdminAction(userId, "remote_control.ticket_denied", "streamer", streamerId);
}

/** Called by relay.ts before bridging any socket. */
export async function validateTicket(ticket: string, signature: string): Promise<TicketPayload | null> {
  const expected = signTicket(ticket);
  const provided = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !timingSafeEqual(provided, expectedBuf)) return null;

  const raw = await redis.get(`${TICKET_PREFIX}${ticket}`);
  if (!raw) return null;
  return JSON.parse(raw) as TicketPayload;
}

/** Immediate revocation — logout, assistant removal, or suspicious activity. */
export async function revokeTicket(ticket: string): Promise<void> {
  await redis.del(`${TICKET_PREFIX}${ticket}`);
}
