// What the browser can reach the API at — baked into the client bundle.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// What THIS Next.js server process can reach the API at. Differs from
// API_BASE_URL when containerized: the browser needs the externally
// published host (e.g. localhost:4000), but a container needs the internal
// Docker service hostname (e.g. api:4000) — "localhost" inside the web
// container refers to itself, not the api container. Defaults to
// API_BASE_URL so plain `npm run dev` (no Docker, both on the host) keeps
// working unchanged.
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? API_BASE_URL;

// Linked from /admin for detailed metrics — Grafana itself isn't proxied
// through this app, just linked to (see docs/architecture.md's
// Observability section for what's on the dashboard).
export const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL ?? "http://localhost:3001";

// The browser connects directly to Centrifugo's WebSocket endpoint (not
// proxied through /api/backend — that proxy is request/response, not a
// persistent connection). Distinct from the API's own CENTRIFUGO_URL
// (apps/api/src/common/env.ts): that's this server's path to Centrifugo's
// HTTP API for server-to-server publish, same host in production but
// never the same value in local dev (container-internal hostname isn't
// reachable from a browser).
export const CENTRIFUGO_WS_URL = process.env.NEXT_PUBLIC_CENTRIFUGO_URL ?? "ws://localhost:8000/connection/websocket";

// Browser-based "go live" — a viewer/creator publishes straight from their
// own camera via WHIP (WebRTC-HTTP Ingestion Protocol), no OBS needed. This
// is SRS's http_api (port 1985), not the http_server (8080) that serves
// HLS — a different port, exposed separately in infra/srs/fly.toml, since
// WHIP signaling and HLS playback are different SRS subsystems entirely.
export const SRS_WHIP_URL = process.env.NEXT_PUBLIC_SRS_WHIP_URL ?? "http://localhost:8443/rtc/v1/whip/";

// The WHIP URL's host is for HTTP routing (works fine as a hostname) — the
// ICE candidate SRS advertises (the `eip` WHIP param) is a *different*
// thing entirely and must be a real IP literal, not a DNS name: WebRTC
// candidates aren't resolved, so a hostname here silently produces an
// unusable candidate and the whole connection hangs at the DTLS stage
// (confirmed live: real symptom was SRS logging "DTLS: Hang, done=0" and
// tearing the session down after its own timeout, not any HTTP-level
// error — the signaling handshake itself was already succeeding).
//
// Includes an explicit :8000 port. Without it, SRS derives the candidate's
// port from whatever it's actually bound to — which, behind the socat
// relay that fronts it on Fly (see infra/srs/docker-entrypoint.sh), is an
// internal-only port, not the real public one a client can reach. `eip`
// supports "ip:port" for exactly this reason.
export const SRS_WEBRTC_PUBLIC_IP = process.env.NEXT_PUBLIC_SRS_WEBRTC_IP ?? "127.0.0.1:8000";

// Remote control's WS relay (apps/api/src/remote-control/relay.ts) is
// mounted directly on the API host, unlike Centrifugo above which is a
// genuinely separate service — same reasoning as the iOS side's
// birqRemoteControlUrl() deriving from birqApiBaseUrl() instead of a second
// independent constant, mirrored here since this is the browser's
// equivalent entry point. Local dev default matches apps/api's own default
// port (see apps/api/src/common/env.ts's API_PORT).
export const REMOTE_CONTROL_WS_URL =
  process.env.NEXT_PUBLIC_REMOTE_CONTROL_WS_URL ?? "ws://localhost:4000/remote-control/relay";

// Default-off kill switch for WHEP (WebRTC) playback, mirrored on the
// server side by apps/api's own WHEP_ENABLED (common/env.ts) — both must
// be on for VideoPlayer.tsx to ever attempt the WHEP engine before falling
// back to hls.js/native HLS. Two independent gates, not one: even if this
// were somehow left on, apps/api's route still refuses every broker
// request until its own flag is set, and vice versa. Off by default for
// the same reason as that flag's own comment — real end-to-end WebRTC/
// ICE/media behavior can't be verified in this environment.
export const WHEP_ENABLED = process.env.NEXT_PUBLIC_WHEP_ENABLED === "true";
