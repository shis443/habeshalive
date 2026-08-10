import type { FastifyPluginAsync } from "fastify";
import type WebSocket from "ws";
import { touchAndCheckSession } from "../auth/session-service.js";
import { isNonSessionToken } from "../auth/token-guards.js";
import { pool } from "../common/db.js";
import { type RemoteControlScope, validateTicket } from "./ticket-service.js";

// The actual fix (see docs/architecture.md's "Remote control" section for
// the full design). Two roles connect to the same endpoint:
//
//   - streamer (the phone): ?role=streamer&token=<the same session JWT
//     every other Birq API call from the phone already uses>. Verified the
//     same way app.authenticate does for a normal HTTP route (signature,
//     non-session-token rejection, live-session check via jti) — just
//     called directly against a query-string token instead of req.jwtVerify()'s
//     header extraction, since this is a WS upgrade, not a normal request.
//     Deliberately NOT stream_key-based: grounding against the real iOS
//     model (ModelBirq.swift's completeBirqLogin) found the phone never
//     actually retains its own raw stream_key as a separate value — it's
//     fetched once and immediately concatenated into the RTMP URL string
//     and discarded. birqToken, by contrast, is already a persistent,
//     Keychain-stored, non-expiring-until-revoked credential the phone
//     carries for every other Birq API call — reusing it here needs no new
//     secret and no Swift-side plumbing to retain one.
//   - assistant (the browser): ?role=assistant&ticket=...&signature=...
//     Authenticated via ticket-service.ts's validateTicket() — this is the
//     step that was missing entirely before this file existed: a ticket
//     minted with no validator on the other end closes nothing.
//
// Once both sides of a bridge are authenticated, this is otherwise a dumb
// pipe: the `hello`/`identify`/challenge-salt-password handshake described
// in protocol.ts still happens end-to-end between the real Swift streamer
// and the browser, tunneled through here unmodified — this relay doesn't
// (and shouldn't) terminate that inner handshake. The one place it *does*
// read the tunneled JSON is the assistant-scope command allowlist below,
// per the locked Phase 2.3 policy: setLive/setRecord and everything else
// stay owner-only, enforced here (not just hidden in the UI), because a
// scope check the client can just not call isn't a scope check.

const ASSISTANT_ALLOWED_COMMANDS = new Set([
  "getStatus",
  "getSettings",
  "setScene",
  "setMute",
  "setBitratePreset",
  "setZoom",
  "setTorch",
]);

// In-process only. Correct as long as apps/api runs as a single instance
// (fly.toml's min_machines_running=1 is a floor, not a ceiling) — see
// docs/architecture.md's "Known limitation" note. Scaling this
// horizontally later needs a Redis-backed cross-instance registry, not
// implemented here since it isn't needed against today's deployment and
// would be speculative complexity against one that doesn't exist yet.
const streamerSockets = new Map<string, WebSocket>();
// At most one bridged assistant per streamer — the underlying protocol
// has no request-id-to-connection routing (see store.ts's own comment:
// requests are correlated by a bare incrementing id, meaningful only
// within one connection), so there's no correct way to fan a streamer's
// replies out to multiple concurrent assistants and have each one's
// pending-request promises resolve against the right reply. A second
// assistant is rejected outright rather than silently corrupting the
// first one's in-flight requests.
const assistantSockets = new Map<string, WebSocket>();

function closeWithReason(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // Already closing/closed — nothing to do.
  }
}

interface ParsedRequest {
  id: number;
  command: string;
}

// Only true `{ request: { id, data: { <command>: {...} } } }` envelopes
// parse here — hello/identify/pong control-plane messages (no `request`
// key) correctly return null and pass through untouched by the filter
// below; they're handshake plumbing, not commands, and Phase 1.6's Swift
// work still needs them to reach the streamer unfiltered.
function parseRequestEnvelope(raw: string): ParsedRequest | null {
  try {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    if (!msg || typeof msg !== "object" || !("request" in msg)) return null;
    const request = msg.request as { id?: unknown; data?: unknown };
    if (typeof request?.id !== "number" || !request.data || typeof request.data !== "object") return null;
    const commandKeys = Object.keys(request.data);
    if (commandKeys.length !== 1) return null;
    return { id: request.id, command: commandKeys[0]! };
  } catch {
    return null;
  }
}

// Returns the message to forward (unchanged for non-command messages and
// allowed commands), or null to block a disallowed command — the caller
// sends a synthetic rejection in that case rather than leaving the
// browser's pending-request promise to time out silently 10s later.
function filterAssistantMessage(raw: string, scope: RemoteControlScope): string | null {
  if (scope === "owner") return raw;
  const parsed = parseRequestEnvelope(raw);
  if (!parsed) return raw; // not a command at all
  return ASSISTANT_ALLOWED_COMMANDS.has(parsed.command) ? raw : null;
}

function buildRejection(raw: string): string | null {
  const parsed = parseRequestEnvelope(raw);
  if (!parsed) return null;
  // Matches MessageToAssistant's real `response` shape (protocol.ts) so
  // the browser's store correctly rejects the pending promise instead of
  // receiving an unrecognized message it silently drops.
  return JSON.stringify({ response: { id: parsed.id, result: "error", data: null } });
}

export const remoteControlRelay: FastifyPluginAsync = async (app) => {
  app.get("/relay", { websocket: true }, async (socket, req) => {
    const query = req.query as Record<string, string | undefined>;
    const role = query.role;

    if (role === "streamer") {
      const token = query.token;
      if (!token) {
        closeWithReason(socket, 4400, "missing token");
        return;
      }

      let userId: string;
      try {
        const decoded = app.jwt.verify<{ sub: string; jti?: string }>(token);
        if (isNonSessionToken(decoded)) {
          closeWithReason(socket, 4401, "invalid token");
          return;
        }
        if (decoded.jti && !(await touchAndCheckSession(decoded.jti))) {
          closeWithReason(socket, 4401, "session revoked");
          return;
        }
        userId = decoded.sub;
      } catch {
        closeWithReason(socket, 4401, "invalid or expired token");
        return;
      }

      const { rowCount } = await pool.query(`SELECT 1 FROM creator_profiles WHERE user_id = $1`, [userId]);
      if (!rowCount) {
        closeWithReason(socket, 4403, "not a creator");
        return;
      }

      // A reconnect (app relaunch, network blip) supersedes any stale
      // prior connection for this same streamer rather than leaving two
      // sockets both claiming to be it.
      streamerSockets.get(userId)?.close(4000, "superseded by new connection");
      streamerSockets.set(userId, socket);

      socket.on("message", (data) => {
        const assistant = assistantSockets.get(userId);
        if (assistant && assistant.readyState === assistant.OPEN) {
          assistant.send(data.toString());
        }
      });
      socket.on("close", () => {
        if (streamerSockets.get(userId) === socket) streamerSockets.delete(userId);
        const assistant = assistantSockets.get(userId);
        if (assistant) closeWithReason(assistant, 4404, "streamer disconnected");
      });
      return;
    }

    if (role === "assistant") {
      const ticket = query.ticket;
      const signature = query.signature;
      if (!ticket || !signature) {
        closeWithReason(socket, 4400, "missing ticket/signature");
        return;
      }

      const payload = await validateTicket(ticket, signature);
      if (!payload) {
        closeWithReason(socket, 4401, "invalid or expired ticket");
        return;
      }

      const streamerSocket = streamerSockets.get(payload.streamerId);
      if (!streamerSocket || streamerSocket.readyState !== streamerSocket.OPEN) {
        closeWithReason(socket, 4404, "streamer is not currently connected");
        return;
      }

      const existingAssistant = assistantSockets.get(payload.streamerId);
      if (existingAssistant && existingAssistant.readyState === existingAssistant.OPEN) {
        closeWithReason(socket, 4409, "another assistant is already connected");
        return;
      }
      assistantSockets.set(payload.streamerId, socket);

      socket.on("message", (data) => {
        const raw = data.toString();
        const forward = filterAssistantMessage(raw, payload.scope);
        if (forward !== null) {
          if (streamerSocket.readyState === streamerSocket.OPEN) streamerSocket.send(forward);
          return;
        }
        const rejection = buildRejection(raw);
        if (rejection) socket.send(rejection);
      });
      socket.on("close", () => {
        if (assistantSockets.get(payload.streamerId) === socket) assistantSockets.delete(payload.streamerId);
      });
      return;
    }

    closeWithReason(socket, 4400, "role must be 'streamer' or 'assistant'");
  });
};
