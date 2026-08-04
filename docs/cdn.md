# Cloudflare CDN — cache rules and DNS topology

**Status: documentation only, not configured.** This needs a real domain and
Cloudflare account, which only a human can provision — there is nothing to
build in the repo for this piece. Everything below was checked against how
this stack's origin (`infra/haproxy`, `infra/srs`) actually behaves, not
assumed from Cloudflare's generic docs.

**See also `docs/egress-protection-plan.md`** for the full staged plan this
feeds into — origin lockdown via Cloudflare Tunnel, Worker-validated signed
viewer tokens, and path-scoped WAF rate limiting on top of the cache rules
below. That plan supersedes this file's Cache Rules section with one
addition (manifests must be `no-store`, not just short-TTL, once they carry
a per-viewer token) — the Segments rule below is unchanged.

## DNS topology — two records, proxied differently

Cloudflare's standard proxy (the orange cloud) only proxies HTTP(S) and
WebSocket. RTMP is a raw TCP protocol it can't inspect, so it needs a
**separate, unproxied** DNS record:

| Record | Points to | Proxy status | Why |
|---|---|---|---|
| `stream.example.com` | HAProxy `:8080` (HLS) | Proxied (orange cloud) | HTTP — this is what CDN caching applies to |
| `ingest.example.com` | HAProxy `:1935` (RTMP) | **DNS only** (grey cloud) | RTMP isn't HTTP; Cloudflare's standard proxy can't carry it. Cloudflare Spectrum (a paid TCP/UDP proxy add-on) is the only way to put this behind Cloudflare at all — otherwise OBS connects straight to the origin |

Centrifugo (chat, WebSocket) *can* be proxied normally — Cloudflare supports
WebSocket upgrade on all plans, unlike raw TCP.

## Cache Rules (not legacy Page Rules)

Verified live against the actual origin: **SRS sets no `Cache-Control` or
`Expires` header on any HLS response** (checked `srs_app_http_static.cpp` —
no such header is ever written) and TLS/CORS are separate — SRS's
`http_server.crossdomain` default (`on`) already sends
`access-control-allow-origin: *` on every response, confirmed with a live
`curl -H "Origin: ..."` against a real published stream, so no extra CORS
work is needed at the CDN layer. Because the origin sends no caching hint at
all, Cloudflare's default heuristics won't reliably cache these paths —
explicit Cache Rules are required, not optional:

1. **Segments** — `http.request.uri.path matches "^/live/.*\.ts$"`
   - Cache eligibility: Eligible for cache
   - Edge TTL: override origin, long (e.g. 1 year) — safe because SRS names
     each segment file uniquely per sequence number
     (`<stream_key>-<seq>.ts`); a given URL is never rewritten in place.
   - Browser TTL: same.

2. **Manifests** — `http.request.uri.path matches "^/live/.*\.m3u8$"`
   - Cache eligibility: Eligible for cache
   - Edge TTL: override origin, short — a rule of thumb is roughly half the
     HLS fragment duration so viewers don't lag behind live. This repo's
     `hls_fragment` is `2` (seconds; see
     `infra/srs/conf/srs.conf.template`, reduced from 4s on 2026-08-04 for
     lower glass-to-glass latency), so **1s** is the matching value — if
     that directive is ever changed, update this TTL too.
   - Browser TTL: bypass (viewers should always re-check).

3. Everything else under `/live/*` not matching the above two (SRS also
   serves `crossdomain.xml` etc. from the same `dir`) — leave un-cached,
   default behavior.

## TLS

The origin (HAProxy) currently terminates plain HTTP only — no TLS
configured anywhere in `infra/haproxy/haproxy.cfg`. Cloudflare's SSL/TLS
mode should be **Flexible** only as a stopgap; the correct end state is
**Full (strict)**, which requires adding real TLS termination at HAProxy
(a `bind *:8443 ssl crt ...` frontend) — not yet built, since it's pointless
to configure without a real domain and certificate to test against.

## What this doesn't cover

Multi-PoP tiered caching (Argo, a paid add-on) would reduce origin load
further for popular streams but isn't necessary to get correctness — the
Cache Rules above are sufficient on any plan, including Free.
