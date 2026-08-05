import {
  whepBrokerRequestSchema,
  whepTeardownRequestSchema,
  type WhepBrokerResponse,
} from "@habeshalive/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { pool } from "../common/db.js";
import { env } from "../common/env.js";
import { AppError } from "../common/errors.js";
import {
  countActiveWhepSessions,
  createWhepSession,
  removeWhepSession,
  type WhepSession,
} from "./whep-session-registry.js";

// Same per-viewer keying as wallet/routes.ts's keyByUser, extended to fall
// back to IP — unlike wallet's mutation routes, watching a stream over
// WHEP doesn't require an account (same anonymous-viewer allowance as HLS
// playback and stream chat, see chat/token.ts's anon-* sub), so this must
// still bound abuse from a caller with no user id at all.
function keyByViewer(req: FastifyRequest): string {
  return req.user?.sub ? `user:${req.user.sub}` : req.ip;
}

function fetchWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

interface SrsClientEntry {
  id: string;
  // NOT the stream name/userId — SRS's own source
  // (vendor/trunk/src/app/srs_app_statistic.cpp's SrsStatisticClient::dumps)
  // sets this to stream_->id_, an internal SRS-generated stream-object
  // identifier (e.g. "vid-275253j"), unrelated to the RTMP/WHIP/WHEP
  // stream name used to publish/play. `name` (req_->stream_) is the
  // actual match target. Found live during a real ffmpeg-publish +
  // moderation/actions-service.ts kill test against production: the real
  // client-list response had stream="vid-275253j" while name correctly
  // held the real userId — filtering on `stream` here never matched
  // anything.
  stream: string;
  name: string;
  publish: boolean;
}

// Best-effort snapshot of currently-connected playback (non-publish)
// client ids for a given stream, from SRS's admin API — used only to
// correlate a just-brokered WHEP session with its SRS-assigned client id
// (see WhepSession.clientId's own comment for why this is a diff, not a
// direct lookup: SRS's client dump has no field that maps back to a
// specific WHEP POST/session token). Never allowed to fail the actual
// broker — an admin-API blip here just means the ban-teardown fallback
// (moderation/actions-service.ts) has one fewer independent path later,
// not that playback itself breaks.
async function listSrsPlaybackClientIds(providerStreamId: string): Promise<Set<string>> {
  try {
    const res = await fetchWithTimeout(
      new URL("/api/v1/clients/?count=100", env.SRS_ADMIN_API_BASE),
      {},
      2000
    );
    if (!res.ok) return new Set();
    const data = (await res.json()) as { clients?: SrsClientEntry[] };
    return new Set(
      (data.clients ?? []).filter((c) => c.name === providerStreamId && c.publish === false).map((c) => c.id)
    );
  } catch {
    return new Set();
  }
}

interface BrokeredWhep {
  answerSdp: string;
  resourceUrl: string;
  clientId: string | null;
}

// Server-to-server SDP exchange with SRS over Fly's private network
// (SRS_ADMIN_API_BASE — see its own comment in common/env.ts for why this
// never touches the public 8443/nginx-filtered port). providerStreamId is
// the creator's userId, the same identifier SRS already knows this stream
// by for RTMP/WHIP/HLS (see streams/service.ts's composeStreamKeyField).
//
// Deliberately not a raw passthrough of the browser's request/response —
// SRS expects (and returns) actual SDP bytes with Content-Type:
// application/sdp, which is exactly what this function speaks to SRS, but
// the *caller* here (the /whep route below) unwraps/rewraps that into the
// JSON envelope apps/web's /api/backend proxy requires (see that proxy's
// own comment on why — it forces every request/response through JSON).
async function brokerWhepOffer(providerStreamId: string, offerSdp: string): Promise<BrokeredWhep> {
  const before = await listSrsPlaybackClientIds(providerStreamId);

  const url = new URL("/rtc/v1/whep/", env.SRS_ADMIN_API_BASE);
  url.searchParams.set("app", "live");
  url.searchParams.set("stream", providerStreamId);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      { method: "POST", headers: { "Content-Type": "application/sdp" }, body: offerSdp },
      8000
    );
  } catch {
    throw new AppError(502, "Could not reach the media server for WebRTC playback");
  }
  if (!res.ok) {
    throw new AppError(502, `Media server rejected the WebRTC offer (${res.status})`);
  }

  const answerSdp = await res.text();
  const resourceUrl = res.headers.get("Location");
  if (!answerSdp || !resourceUrl) {
    throw new AppError(502, "Media server returned an incomplete WebRTC answer");
  }

  // The one client id that appeared between the two snapshots. Left
  // unresolved (null), not guessed, if that's ambiguous (e.g. a second
  // viewer's join lands in the same window) — see WhepSession.clientId.
  const after = await listSrsPlaybackClientIds(providerStreamId);
  const newIds = [...after].filter((id) => !before.has(id));
  const clientId = newIds.length === 1 ? newIds[0]! : null;

  return { answerSdp, resourceUrl, clientId };
}

// Real SRS-side teardown for a brokered session — shared by the
// viewer-initiated DELETE route below and moderation/actions-service.ts's
// ban-teardown, since both need to end the same kind of session the same
// way. Two independent attempts, not one primary with the other as a mere
// backstop: SRS's own DELETE-by-resource-URL handler always returns 200
// whether or not it actually found a live session to expire (confirmed
// against SRS's own source — vendor/trunk/src/app/srs_app_rtc_api.cpp),
// so the admin-API kick (when a client id was successfully correlated at
// broker time) is a genuinely separate mechanism, not redundant
// belt-and-suspenders.
export async function teardownWhepSession(session: WhepSession): Promise<void> {
  try {
    const deleteUrl = new URL(session.whepResourceUrl, env.SRS_ADMIN_API_BASE);
    await fetchWithTimeout(deleteUrl, { method: "DELETE" }, 3000);
  } catch (err) {
    console.error(`[whep] resource-URL teardown failed for session ${session.sessionId}:`, err);
  }

  if (session.clientId) {
    try {
      const kickUrl = new URL(`/api/v1/clients/${session.clientId}`, env.SRS_ADMIN_API_BASE);
      await fetchWithTimeout(kickUrl, { method: "DELETE" }, 3000);
    } catch (err) {
      console.error(`[whep] admin-API kick failed for session ${session.sessionId}:`, err);
    }
  }
}

export const whepRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>(
    "/:id/whep",
    {
      preHandler: app.tryAuthenticate,
      config: { rateLimit: { max: 5, timeWindow: "1 minute", hook: "preHandler", keyGenerator: keyByViewer } },
    },
    async (req): Promise<WhepBrokerResponse> => {
      // Default-off kill switch — see env.ts's own comment on why: real
      // end-to-end WebRTC/ICE/media behavior can't be verified in this
      // environment, so this stays disabled in production until someone
      // has actually watched a real stream over it.
      if (!env.WHEP_ENABLED) throw new AppError(503, "WHEP playback is not enabled");

      // Live ban check, same reasoning as app.rejectIfBanned elsewhere —
      // a JWT can outlive the ban it was issued before. Not app.rejectIfBanned
      // itself: that decorator assumes an authenticated req.user (it's
      // always paired with app.authenticate on other routes), which would
      // throw reading req.user.sub for the anonymous viewers this route
      // must still allow — HLS/chat both permit watching without an
      // account, and WHEP is a playback path, not a mutation, so it keeps
      // that same allowance.
      const viewerId = req.user?.sub;
      if (viewerId) {
        const { rows } = await pool.query<{ is_banned: boolean }>(`SELECT is_banned FROM users WHERE id = $1`, [
          viewerId,
        ]);
        if (rows[0]?.is_banned) throw new AppError(403, "Your account is banned.");
      }

      const input = whepBrokerRequestSchema.parse(req.body);

      const { rows: streamRows } = await pool.query<{ status: string; provider_stream_id: string | null }>(
        `SELECT status, provider_stream_id FROM streams WHERE id = $1`,
        [req.params.id]
      );
      const stream = streamRows[0];
      if (!stream) throw new AppError(404, "Stream not found");
      if (stream.status !== "live" || !stream.provider_stream_id) {
        throw new AppError(409, "This stream is not live");
      }

      // Checked before brokering (not after) — SRS itself has no session
      // cap of its own, so without this a burst of joins has nothing
      // bounding it before it's already committed real WebRTC/CPU cost on
      // the one srs machine. See env.ts's own comment on why this is a
      // machine-wide backstop, not a per-user/per-stream limit.
      if ((await countActiveWhepSessions()) >= env.WHEP_MAX_CONCURRENT_SESSIONS) {
        throw new AppError(503, "WebRTC playback is at capacity, try again shortly");
      }

      const brokered = await brokerWhepOffer(stream.provider_stream_id, input.offerSdp);

      const session = await createWhepSession({
        // Anonymous viewers get a non-matchable synthetic key (never
        // collides with a real users.id — same "anon-" prefixing trick as
        // chat/token.ts) purely for bookkeeping; ban-teardown only ever
        // looks sessions up by a real userId, so these can never be found
        // (correctly — an anonymous session was never eligible to be
        // banned in the first place).
        userId: viewerId ?? `anon:${req.ip}`,
        streamId: req.params.id,
        whepResourceUrl: brokered.resourceUrl,
        clientId: brokered.clientId,
      });

      return { answerSdp: brokered.answerSdp, sessionId: session.sessionId };
    }
  );

  app.delete<{ Params: { id: string } }>("/:id/whep", async (req, reply) => {
    const input = whepTeardownRequestSchema.parse(req.body);
    const session = await removeWhepSession(input.sessionId);
    // Already gone (double-teardown, e.g. both a component-unmount call
    // and a ban racing each other) — not an error, DELETE is idempotent.
    if (session) await teardownWhepSession(session);
    reply.send({ ok: true });
  });
};
