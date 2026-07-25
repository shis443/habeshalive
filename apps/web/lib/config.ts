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
