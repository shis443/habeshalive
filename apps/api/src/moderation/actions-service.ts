import type { ModerationActionRecord } from "@birq/shared";
import { logAdminAction } from "../admin/audit.js";
import { disconnectUserRealtime } from "../chat/token.js";
import { pool } from "../common/db.js";
import { env } from "../common/env.js";
import { resolveSrsNodeCount } from "../common/srs-topology.js";
import { AppError } from "../common/errors.js";
import { notify } from "../notifications/service.js";
import { listWhepSessionsForUser, removeWhepSession } from "../streams/whep-session-registry.js";
import { teardownWhepSession } from "../streams/whep-routes.js";

interface SrsClientEntry {
  id: string;
  // NOT the stream name/userId — SRS's own source
  // (vendor/trunk/src/app/srs_app_statistic.cpp's SrsStatisticClient::dumps)
  // sets this to stream_->id_, an internal SRS-generated stream-object
  // identifier (e.g. "vid-275253j"), completely unrelated to the RTMP
  // stream name used to publish. `name` (req_->stream_) is the actual
  // match target. Found live: a real ffmpeg test publish against
  // production showed stream="vid-275253j" while name correctly held the
  // real userId — this field was never usable for matching, and the
  // original filter below silently never matched anything as a result.
  stream: string;
  name: string;
  publish: boolean;
}

function fetchWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

// Adversarial security rationale — required before implementation per the
// BIRQ guidelines' Part I §5 (a reviewable step-by-step rationale, not
// just code), reasoned through with a penetration-tester mindset before
// writing killActiveRtmpPublishers below:
//
// 1. THE GAP THIS CLOSES: a banned user's already-active RTMP publish
//    session (OBS/encoder connected *before* the ban landed) kept
//    broadcasting indefinitely. `is_banned` was only ever checked at
//    publish time (streams/service.ts's markLiveByProviderStreamId),
//    never against a connection already past that gate — the exact gap
//    docs/ROADMAP.md names: "No mechanism kills an active RTMP session on
//    ban." This function is the fix; it does not replace the
//    publish-time check, it complements it (a banned user still can't
//    START a new publish either way — both defenses now exist).
//
// 2. DOES THE FIX ITSELF OPEN A NEW HOLE? No new user-controlled input
//    ever reaches SRS's admin API here. The only parameter is
//    `providerStreamId`, which callers pass as `targetUserId` — already
//    validated server-side by the caller's own preHandler
//    (moderation/routes.ts's POST /actions/ban requires
//    `app.requireAdmin`; `targetUserId` is never attacker-supplied to an
//    unauthenticated caller). The actual SRS `client_id` used for the
//    kill is resolved from a live, server-initiated GET against
//    `SRS_ADMIN_API_BASE` (Fly's private network only — see
//    common/env.ts's own comment on why this is never the public,
//    nginx-filtered port), not supplied by any request body or client.
//
// 3. FAIL-OPEN BY DESIGN, NOT ACCIDENT: if SRS's admin API is unreachable
//    (network blip, SRS mid-deploy), this must NOT roll back or block the
//    ban itself. The real security boundary is `is_banned` blocking every
//    *future* publish/WHEP/chat action (already enforced elsewhere), not
//    this best-effort disconnect of an already-open session — same
//    detached, non-blocking pattern as disconnectUserRealtime and the
//    WHEP teardown below, applied here for the identical reason.
//
// 4. RACE CONDITION: between listing SRS's clients and issuing the
//    `DELETE`, the target's session could legitimately end and a
//    *different* stream's connection could later reuse the same numeric
//    id. Low-impact even if it happens: SRS's DELETE handler 404s
//    cleanly on a stale id (`ERROR_RTMP_CLIENT_NOT_FOUND`) rather than
//    silently kicking an unrelated session — confirmed against SRS's own
//    source (vendor/trunk/src/app/srs_app_http_api.cpp's
//    `SrsGoApiClients::serve_http`), not assumed. The window is also
//    small: this runs immediately after the ban's DB transaction commits.
//
// 5. WHY A LIVE LOOKUP, NOT A STORED client_id: unlike WHEP (where
//    apps/api itself brokers the session and can capture SRS's response
//    at creation time — see whep-session-registry.ts's WhepSession.clientId),
//    an RTMP publisher connects **directly to SRS**; apps/api is never in
//    that signaling path. SRS's `on_publish` webhook
//    (`srsCallbackSchema`, packages/shared/src/schemas/streams.ts) carries
//    only `{ stream, param }` — no client id. A live GET at ban-time
//    against SRS's real-time client list is the only correct source of
//    truth for "which connection, if any, is this user's active publish."
//
// 6. WHY FILTER name === providerStreamId, NOT ip OR anything else:
//    `provider_stream_id` on the `streams` table is the creator's own
//    userId (streams/service.ts's composeStreamKeyField/getPlaybackUrl —
//    the same identifier SRS already knows this stream by for
//    RTMP/WHIP/HLS), so `targetUserId` passed straight through as the
//    filter is both correct and requires no extra DB lookup inside this
//    function. Matched against `name`, not `stream` — see
//    SrsClientEntry's own comment for why `stream` is the wrong field
//    (an internal SRS stream-object id, not the RTMP stream name).
// Exported — also reused by streams/service.ts's rotateStreamKey (a
// regenerated stream key should immediately disconnect whatever's
// currently publishing under the old one, same underlying SRS admin-API
// mechanism as a ban, not just a second, subtly-different copy of it).
export async function killActiveRtmpPublishers(providerStreamId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithTimeout(new URL("/api/v1/clients/?count=100", env.SRS_ADMIN_API_BASE), {}, 3000);
  } catch (err) {
    console.error(`[moderation] SRS client list fetch failed for ${providerStreamId}:`, err);
    return;
  }
  if (!res.ok) {
    console.error(`[moderation] SRS client list returned HTTP ${res.status} for ${providerStreamId}`);
    return;
  }

  let data: { clients?: SrsClientEntry[] };
  try {
    data = (await res.json()) as { clients?: SrsClientEntry[] };
  } catch (err) {
    console.error(`[moderation] SRS client list JSON parse failed for ${providerStreamId}:`, err);
    return;
  }

  // publish === true covers both RTMP and WHIP publishers (SRS reports
  // both the same way in this listing — see WhepSession.clientId's own
  // comment in whep-session-registry.ts for the equivalent WHEP-side
  // finding) — a banned creator's session is killed regardless of which
  // protocol they published with.
  const targets = (data.clients ?? []).filter((entry) => entry.name === providerStreamId && entry.publish === true);

  await Promise.all(
    targets.map(async (entry) => {
      try {
        await fetchWithTimeout(
          new URL(`/api/v1/clients/${entry.id}`, env.SRS_ADMIN_API_BASE),
          { method: "DELETE" },
          3000
        );
      } catch (err) {
        console.error(`[moderation] SRS kick failed for client ${entry.id} (${providerStreamId}):`, err);
      }
    })
  );
}

// The confirmed-kill counterpart to killActiveRtmpPublishers above.
//
// WHY A SECOND FUNCTION RATHER THAN A FLAG ON THE FIRST: the two callers
// want opposite failure behaviour, and conflating them would break one of
// them. killActiveRtmpPublishers is best-effort by design (see its own
// point 3): it runs after a ban or a key rotation, where the real security
// boundary is is_banned / the rotated key blocking every *future* publish,
// and an SRS outage must never fail the ban itself. This one runs behind an
// admin pressing "force end", where the entire point is that the broadcast
// stops now — so an unconfirmed kill has to be reported as unconfirmed, not
// swallowed.
//
// Throws on: SRS unreachable, non-2xx client listing, unparseable listing,
// or any individual DELETE failing. Returns the number of publisher
// connections actually killed.
//
// Zero targets is SUCCESS, not failure: it means no publisher is connected
// under that name, which is the goal state. SRS 404s cleanly on an already-
// gone client rather than reporting a phantom.
// SRS's DELETE /api/v1/clients/<id> returns HTTP 200 REGARDLESS of whether
// anything was actually killed — confirmed live against a running SRS
// instance: `curl -X DELETE .../clients/bogus-id` returns
// `HTTP/1.1 200 OK` with body `{"code":2049}` (ERROR_RTMP_CLIENT_NOT_FOUND,
// srs_error_t.h). Checking only `res.ok` (any 2xx) is not a bug that was
// merely theoretical — it is what this codebase's first cut of this exact
// function did, and it would have reported every kill as confirmed
// regardless of whether SRS did anything at all. `code === 0` is SRS's own
// success/failure signal for this endpoint and the only one that means
// anything.
async function parseSrsDeleteResult(res: Response): Promise<{ ok: boolean; code?: number }> {
  if (!res.ok) return { ok: false };
  try {
    const body = (await res.json()) as { code?: number };
    return { ok: body.code === 0, code: body.code };
  } catch {
    return { ok: false };
  }
}

export interface KillPublisherOptions {
  // Captured from SRS's on_publish payload at the moment this exact
  // session started publishing (migration 0051, streams.srs_client_id).
  // When present this is the ENTIRE mechanism: a direct, targeted DELETE,
  // retried only to route past the load-balanced admin API — never a
  // cluster-wide search. Absent for WHIP-originated 'starting' rows or any
  // legacy row from before this was captured, in which case this falls
  // back to the original search-by-name approach.
  knownClientId?: string;
}

// Node-aware because the admin API is load-balanced.
// infra/haproxy/haproxy.cfg fronts N SRS nodes, balancing RTMP publishers
// by `leastconn` (one node, for the life of the connection) and the admin
// API by `roundrobin` (mode tcp — a fresh connection per request, since
// SRS itself sends `Connection: Close` on every admin-API response,
// confirmed live: 12 sequential requests against a real 2-node cluster
// alternated nodes perfectly, never repeating). A single admin-API
// request therefore has roughly 1-in-N odds of reaching the node hosting
// any given publisher. SRS stamps every response with a unique `server`
// id (the same value on_publish sends as `server_id` — both read
// stat_->server_id(), confirmed against srs_app_http_api.cpp and
// srs_app_http_hooks.cpp), which is how this knows whether it has looked
// everywhere before concluding "not broadcasting anywhere".
export async function killPublisherConfirmed(
  providerStreamId: string,
  options: KillPublisherOptions = {}
): Promise<number> {
  const nodeCount = await resolveSrsNodeCount();
  const maxAttempts = Math.max(4, nodeCount * 4);

  // FAST PATH: a known client_id from this exact publish session. Skips
  // the cluster-wide search entirely, and closes a real race the search
  // path cannot: SRS assigns a fresh client_id per TCP connection, so if
  // the creator's encoder drops and reconnects between two listing polls,
  // a name-based search can miss the new session or, worse, could in
  // principle observe a *different* session under the same stream name.
  // Targeting the specific id captured at publish time cannot be confused
  // by a later reconnect — that reconnect gets its own, different id.
  if (options.knownClientId) {
    const serversSeen = new Set<string>();
    let lastFailure: string | null = null;
    let notFoundCount = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await fetchWithTimeout(
          new URL(`/api/v1/clients/${options.knownClientId}`, env.SRS_ADMIN_API_BASE),
          { method: "DELETE" },
          3000
        );
      } catch (err) {
        lastFailure = `media server unreachable: ${(err as Error).message}`;
        continue;
      }

      // The listing endpoint tags responses with `server`; the DELETE
      // endpoint's success/not-found body does not carry that same field
      // (confirmed live: `{"code":2049}` on not-found, no server key) — so
      // node coverage for this fast path is inferred from attempt count,
      // not from an id we don't get here. Bounding at nodeCount attempts
      // dedicated to "not found" responses (separate from transient
      // failures, which retry within the same budget) is what stands in
      // for that coverage guarantee.
      const parsed = await parseSrsDeleteResult(res);
      if (parsed.ok) return 1;
      if (parsed.code === 2049) {
        notFoundCount++;
        if (notFoundCount >= nodeCount) {
          // Not found on at least `nodeCount` distinct attempts against a
          // round-robined, connection-per-request backend is the closest
          // this endpoint's response shape allows to "checked every node".
          return 0;
        }
        continue;
      }
      lastFailure = `media server returned unexpected code ${parsed.code ?? "(none)"}`;
    }

    throw new AppError(
      502,
      `Kill not confirmed via known client id — ${lastFailure ?? "the publisher could not be dropped"}`
    );
  }

  // FALLBACK PATH: no captured identity (WHIP session, or a row from
  // before migration 0051). Searches the whole cluster by stream name,
  // exactly as before, but now checking the DELETE's actual `code` rather
  // than its HTTP status.
  const serversSeen = new Set<string>();
  let killed = 0;
  let lastFailure: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetchWithTimeout(new URL("/api/v1/clients/?count=100", env.SRS_ADMIN_API_BASE), {}, 3000);
    } catch (err) {
      lastFailure = `media server unreachable: ${(err as Error).message}`;
      continue;
    }
    if (!res.ok) {
      lastFailure = `media server returned HTTP ${res.status}`;
      continue;
    }

    let data: { server?: string; clients?: SrsClientEntry[] };
    try {
      data = (await res.json()) as { server?: string; clients?: SrsClientEntry[] };
    } catch (err) {
      lastFailure = `media server sent an unreadable client list: ${(err as Error).message}`;
      continue;
    }
    if (data.server) serversSeen.add(data.server);

    const targets = (data.clients ?? []).filter(
      (entry) => entry.name === providerStreamId && entry.publish === true
    );

    for (const entry of targets) {
      let dropped = false;
      for (let d = 0; d < maxAttempts && !dropped; d++) {
        try {
          const killRes = await fetchWithTimeout(
            new URL(`/api/v1/clients/${entry.id}`, env.SRS_ADMIN_API_BASE),
            { method: "DELETE" },
            3000
          );
          const parsed = await parseSrsDeleteResult(killRes);
          if (parsed.ok) dropped = true;
          else lastFailure = `media server refused to drop client ${entry.id} (code ${parsed.code ?? "unknown"})`;
        } catch (err) {
          lastFailure = `failed to drop client ${entry.id}: ${(err as Error).message}`;
        }
      }
      if (!dropped) {
        throw new AppError(502, `Kill not confirmed — ${lastFailure ?? "the publisher could not be dropped"}`);
      }
      killed++;
    }

    if (serversSeen.size >= nodeCount && killed === 0) return 0;
    if (killed > 0 && serversSeen.size >= nodeCount) return killed;
  }

  if (killed > 0) return killed;
  throw new AppError(
    502,
    `Kill not confirmed — only reached ${serversSeen.size} of ${nodeCount} media server node(s)` +
      (lastFailure ? `: ${lastFailure}` : "")
  );
}

export async function banUser(actorId: string, targetUserId: string, reason?: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ is_banned: boolean }>(
      `SELECT is_banned FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId]
    );
    if (!rows[0]) throw new AppError(404, "User not found");
    if (rows[0].is_banned) throw new AppError(400, "User is already banned");

    await client.query(`UPDATE users SET is_banned = TRUE, updated_at = now() WHERE id = $1`, [targetUserId]);
    await client.query(
      `INSERT INTO moderation_actions (actor_id, target_user_id, action, reason) VALUES ($1, $2, 'ban', $3)`,
      [actorId, targetUserId, reason ?? null]
    );
    await logAdminAction(actorId, "user.ban", "user", targetUserId, { reason, client });
    await client.query("COMMIT");
    await notify(targetUserId, "moderation_action", "Your account was banned", {
      body: reason,
      linkUrl: "/safety-center",
    });
    // Previously a ban only set a DB flag — an already-open chat/gift-alert
    // WebSocket kept working until its token naturally expired (up to an
    // hour). Detached like notify() above: a Centrifugo blip here shouldn't
    // fail the ban action itself, see disconnectUserRealtime's own comment.
    disconnectUserRealtime(targetUserId, reason ?? "Account banned").catch((err) => {
      console.error("[moderation] disconnectUserRealtime failed:", err);
    });
    // Same reasoning as disconnectUserRealtime above, extended to WHEP
    // (WebRTC) playback: a ban previously only stopped a banned user from
    // opening a *new* WHEP session (whep-routes.ts's live is_banned
    // check) — an already-open one kept streaming media until the viewer
    // closed the tab, since WebRTC has no token-expiry mechanism the way
    // Centrifugo's connection tokens do. Detached (no await) — a media-
    // server blip here shouldn't fail the ban action itself. Every
    // session for this user across any stream is torn down, not just one,
    // since a ban isn't scoped to "whatever they happened to be watching."
    listWhepSessionsForUser(targetUserId)
      .then((sessions) =>
        Promise.all(
          sessions.map(async (session) => {
            // Registry cleanup first, same ordering as the viewer-initiated
            // DELETE route (whep-routes.ts) — so the concurrency ceiling
            // (whep-session-registry.ts's countActiveWhepSessions) reflects
            // this session as gone immediately, not just after the SRS
            // round-trip below completes.
            await removeWhepSession(session.sessionId);
            await teardownWhepSession(session);
          })
        )
      )
      .catch((err) => {
        console.error("[moderation] WHEP teardown failed:", err);
      });
    // See killActiveRtmpPublishers's own adversarial-reasoning comment
    // block above for the full rationale. Detached, same as the two calls
    // above — this is best-effort cleanup of an already-open session, not
    // the security boundary itself.
    killActiveRtmpPublishers(targetUserId).catch((err) => {
      console.error("[moderation] killActiveRtmpPublishers failed:", err);
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function unbanUser(actorId: string, targetUserId: string, reason?: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ is_banned: boolean }>(
      `SELECT is_banned FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId]
    );
    if (!rows[0]) throw new AppError(404, "User not found");
    if (!rows[0].is_banned) throw new AppError(400, "User is not banned");

    await client.query(`UPDATE users SET is_banned = FALSE, updated_at = now() WHERE id = $1`, [targetUserId]);
    await client.query(
      `INSERT INTO moderation_actions (actor_id, target_user_id, action, reason) VALUES ($1, $2, 'unban', $3)`,
      [actorId, targetUserId, reason ?? null]
    );
    await logAdminAction(actorId, "user.unban", "user", targetUserId, { reason, client });
    await client.query("COMMIT");
    await notify(targetUserId, "moderation_action", "Your account was unbanned", {
      body: reason,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// moderation_actions has been written to since the ban/unban endpoints
// shipped but nothing ever read it back for a human — this is that
// missing read side.
export async function listModerationActions(limit = 100): Promise<ModerationActionRecord[]> {
  const { rows } = await pool.query<{
    id: string;
    actor_username: string;
    target_username: string;
    action: ModerationActionRecord["action"];
    reason: string | null;
    duration_seconds: number | null;
    created_at: string;
  }>(
    `SELECT ma.id, actor.username AS actor_username, target.username AS target_username,
            ma.action, ma.reason, ma.duration_seconds, ma.created_at
     FROM moderation_actions ma
     JOIN users actor ON actor.id = ma.actor_id
     JOIN users target ON target.id = ma.target_user_id
     ORDER BY ma.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    actorUsername: row.actor_username,
    targetUsername: row.target_username,
    action: row.action,
    reason: row.reason,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
  }));
}
