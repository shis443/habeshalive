import { randomUUID } from "node:crypto";
import { redis } from "../common/redis.js";

// Tracks live WHEP (WebRTC playback) sessions brokered through
// whep-routes.ts — Redis-only, no DB migration, matching how this
// codebase already treats other short-lived connection state (Centrifugo
// presence, rate-limit buckets) as ephemeral rather than durable. A
// session here means "apps/api brokered an SDP exchange with SRS on this
// viewer's behalf and is holding onto what's needed to tear it down
// later" — moderation/actions-service.ts's banUser reads this to force-end
// a banned viewer's live WebRTC playback, the same way it already does for
// Centrifugo chat connections (see chat/token.ts's disconnectUserRealtime).
export interface WhepSession {
  sessionId: string;
  userId: string;
  streamId: string;
  // SRS's own WHIP/WHEP DELETE-teardown URL, captured verbatim from the
  // `Location` response header SRS returns at session-creation time (see
  // vendor/trunk/src/app/srs_app_rtc_api.cpp's serve_http_with — it's a
  // query-string action on /rtc/v1/whep/, not a REST resource path: e.g.
  // "/rtc/v1/whep/?action=delete&token=...&app=live&stream=...&session=...").
  // The primary, code-proven teardown mechanism — SRS's own DELETE handler
  // for this exact path already works for WHIP publish teardown today
  // (GoLivePanel.tsx's own stop-stream flow).
  whepResourceUrl: string;
  // SRS admin API's generic per-connection id (the numeric-ish `id` field
  // from GET /api/v1/clients/), captured best-effort at broker time by
  // matching the newly-appeared client entry — NOT the same id space as
  // the RTC `session` token above (confirmed against SRS's own source:
  // /api/v1/clients/{id} and the WHIP/WHEP session token are two entirely
  // separate identifiers). A secondary, best-effort fallback only: SRS's
  // primary DELETE handler returns 200 whether or not it actually found a
  // live session to expire, so this exists to give the ban path a second,
  // independent way to kick the connection if the primary DELETE silently
  // no-ops. Null when the correlation attempt didn't find a confident
  // match — the primary teardown still runs either way.
  clientId: string | null;
  startedAt: string;
}

// Matches streams/service.ts's STALE_STREAM_MAX_DURATION_MS — a WHEP
// session has no business outliving that same backstop, and this TTL is
// purely a leak guard (normal teardown always explicitly removes the key;
// this only matters if a browser tab dies without ever calling DELETE).
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function sessionKey(sessionId: string): string {
  return `whep:session:${sessionId}`;
}
function userSessionsKey(userId: string): string {
  return `whep:user-sessions:${userId}`;
}
const ACTIVE_SESSIONS_SET = "whep:active-sessions";

export async function countActiveWhepSessions(): Promise<number> {
  return redis.scard(ACTIVE_SESSIONS_SET);
}

export async function createWhepSession(params: {
  userId: string;
  streamId: string;
  whepResourceUrl: string;
  clientId: string | null;
}): Promise<WhepSession> {
  const session: WhepSession = {
    sessionId: randomUUID(),
    userId: params.userId,
    streamId: params.streamId,
    whepResourceUrl: params.whepResourceUrl,
    clientId: params.clientId,
    startedAt: new Date().toISOString(),
  };
  await redis
    .multi()
    .set(sessionKey(session.sessionId), JSON.stringify(session), "EX", SESSION_TTL_SECONDS)
    .sadd(ACTIVE_SESSIONS_SET, session.sessionId)
    .sadd(userSessionsKey(params.userId), session.sessionId)
    .exec();
  return session;
}

async function loadSession(sessionId: string): Promise<WhepSession | null> {
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  return JSON.parse(raw) as WhepSession;
}

export async function getWhepSession(sessionId: string): Promise<WhepSession | null> {
  return loadSession(sessionId);
}

// All of a user's active WHEP sessions across every stream — what
// moderation/actions-service.ts's banUser needs, since a ban must tear
// down playback regardless of what the banned user happens to be watching.
export async function listWhepSessionsForUser(userId: string): Promise<WhepSession[]> {
  const sessionIds = await redis.smembers(userSessionsKey(userId));
  const sessions: WhepSession[] = [];
  for (const sessionId of sessionIds) {
    const session = await loadSession(sessionId);
    if (session) sessions.push(session);
    else await redis.srem(userSessionsKey(userId), sessionId);
  }
  return sessions;
}

// Removes the registry entry and returns what it held, so the caller can
// still perform the real SRS-side teardown (whepResourceUrl/clientId)
// after the registry itself is already cleaned up — same order as
// everywhere else in this codebase that does a local mutation before a
// best-effort external call (see disconnectUserRealtime's own comment on
// why registry/DB state shouldn't depend on an external call succeeding).
export async function removeWhepSession(sessionId: string): Promise<WhepSession | null> {
  const session = await loadSession(sessionId);
  if (!session) return null;
  await redis
    .multi()
    .del(sessionKey(sessionId))
    .srem(ACTIVE_SESSIONS_SET, sessionId)
    .srem(userSessionsKey(session.userId), sessionId)
    .exec();
  return session;
}
