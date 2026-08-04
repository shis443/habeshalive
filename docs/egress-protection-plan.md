# Egress protection plan — anonymous public HLS/VOD viewing

**Status: plan only, nothing provisioned or deployed.** No Cloudflare
account/zone changes, no DNS changes, no Fly.io topology changes have been
made as part of writing this. This scopes exactly what `docs/ROADMAP.md`'s
"Deferred by deliberate choice" item (egress/CDN cost protection) and
`docs/SECURITY.md`'s known-accepted-risk #4 call for: a real
infrastructure/cost decision that needs a human to provision accounts and
sign off on vendor/budget choice before anything here gets built.

## Why this replaces two narrower ideas already considered and rejected

Two smaller alternatives were evaluated first and are **not** the direction
here:

- **SRS-level AES-128 HLS encryption with a rate-limited key-delivery
  route.** Technically deployable without a new vendor, but it only stops
  *playback* of scraped segments — it doesn't reduce egress bandwidth spent
  serving them in the first place (a scraper can still pull every segment,
  just can't decode them), and it means hand-authoring HAProxy/SRS config
  changes against production media infrastructure with no staging
  environment to verify them in before a real deploy.
- **Native HAProxy IP rate limiting (`stick-table`) in
  `infra/haproxy/haproxy.cfg`.** This file is only used by the local
  docker-compose multi-node topology. **Production runs a single Fly.io SRS
  machine with nothing in front of it** (`docs/architecture.md`'s Video
  pipeline section: "directly in production, which is a single SRS Fly
  machine") — a HAProxy change would protect nothing real.

The actual fix has to sit in front of the real production origin, which
means a CDN/edge layer. `docs/cdn.md` already scoped the Cloudflare cache
rules for this (verified against SRS's real response headers) — this plan
builds on that and adds the two things it explicitly didn't cover: origin
lockdown and request-level authorization.

## 0. Scope

**In scope:** anonymous (no-login) public viewing of live HLS and VOD,
matching the access model already decided for this platform — streams stay
watchable without an account; the fix is anti-hotlinking/anti-scraping and
egress-cost control, not a subscription paywall.

**Out of scope for this pass:**
- RTMP ingest protection — already covered by `docs/cdn.md`'s DNS topology
  (`ingest.example.com`, unproxied/grey-cloud; Cloudflare Spectrum would be
  the paid option to change that, not needed here).
- WHIP/WebRTC signaling — no viewer-facing WebRTC playback exists in this
  codebase (WHIP is publish-only; see the earlier BIRQ audit).
- Any content-gating by subscription tier — explicitly not the chosen model.

## Target topology

```
                         Cloudflare edge (proxied, orange cloud)
                         ┌─────────────────────────────────────┐
Browser (hls.js /        │  WAF + rate limiting (path-scoped)   │
 native Safari HLS) ────▶│  Cache Rules (segments long-TTL,     │
                         │              manifests bypass)        │
                         │  Worker: validates viewer token,      │
                         │          rewrites manifest URIs       │
                         └───────────────┬───────────────────────┘
                                          │ Cloudflare Tunnel
                                          │ (outbound-only from origin,
                                          │  no public origin port)
                                          ▼
                              Fly.io SRS machine (origin, locked down:
                              only accepts Tunnel-authenticated traffic)

VOD: browser ──HTTPS──▶ R2 bucket directly, via a short-lived presigned
     GetObject URL apps/api already issues (see "VOD" section — this half
     is already implemented, not part of what this plan still needs).
```

## 1. DNS & Cloudflare zone topology

- New record `stream.<domain>` → **proxied** (orange cloud). This becomes
  the value of `SRS_HTTP_HOST`/`SRS_HTTP_SCHEME` in production once live —
  `streams/video-provider.ts`'s `getPlaybackUrl` already builds the
  playback URL from those two env vars, so switching hosts needs zero code
  change, only an env update.
- `ingest.<domain>` (RTMP, 1935) stays exactly as `docs/cdn.md` already
  specifies — DNS-only, unrelated to this plan.
- No change to the existing `WEB_PUBLIC_URL`/`API_PUBLIC_URL` records
  (Vercel + Fly API respectively) — this plan only touches the media
  origin.

## 2. Origin lockdown — Cloudflare Tunnel

**Why Tunnel over "Authenticated Origin Pulls" (mTLS):** Origin Pulls needs
the origin's TLS layer to validate Cloudflare's client certificate. SRS's
own HTTP server has no support for that, so it would require adding a
TLS-terminating reverse proxy in front of SRS on Fly (another moving part,
another thing that can silently misconfigure and either leak or block
traffic). Tunnel instead runs `cloudflared` as an outbound-only connector —
the origin never needs a public listener at all, which is a strictly
simpler failure mode: misconfigured Tunnel means "unreachable," not
"accidentally still open to the public internet."

- Run `cloudflared` as an additional process on the existing SRS Fly
  machine (Fly supports multiple processes per app via `[processes]` in
  `fly.toml`), authenticated with a Tunnel token issued from the Cloudflare
  Zero Trust dashboard (human step — new account/zone artifact, not
  something to fabricate here).
- Tunnel routes `stream.<domain>` → `http://localhost:8080` (SRS's own
  `http_service`, already what `infra/srs/fly.toml`'s `[http_service]`
  block exposes today — just consumed via `localhost` instead of Fly's
  public edge).
- Once Tunnel connectivity is confirmed (see Staging, below), remove
  `infra/srs/fly.toml`'s public `[http_service]` block for port 8080 (or
  restrict it to Fly's private networking / Cloudflare's published IP
  ranges as a belt-and-suspenders step during the transition window — see
  Rollout).
- The RTMP (`1935`) and WHIP-signaling (`8443`) `[[services]]` blocks in
  `infra/srs/fly.toml` are untouched — Tunnel only replaces the HLS/HTTP
  path.

**Acceptance criteria:** a direct request to the SRS Fly app's own
`*.fly.dev` hostname for any `/live/*` path returns unreachable/refused
once lockdown is complete; only requests through `stream.<domain>` succeed.

## 3. Anonymous viewer-session tokens (Cloudflare Worker)

**Design choice — rewrite the manifest at the edge, don't rely on the
player forwarding query strings.** SRS writes one shared, static
`.m3u8`/`.ts`/`.key` file set per stream (not personalized per viewer), and
this app's `VideoPlayer.tsx` falls back to Safari's *native* HLS engine for
some clients — which has no hook for attaching a token to each derived
segment request the way `hls.js`'s `xhrSetup` could. Relying on
client-side propagation would mean two different, unverified code paths.
Instead, the Worker does the propagation itself:

1. `apps/api`'s `getPlaybackUrl` (currently
   `streams/video-provider.ts:24-26`) appends a signed, short-lived token
   query param to the top-level manifest URL it already returns —
   `https://stream.<domain>/live/<userId>.m3u8?t=<token>`. Token = HS256
   JWT-shaped payload `{ streamId, exp }`, signed with a **new** dedicated
   secret (`HLS_TOKEN_HMAC_SECRET`), reusing the exact hand-rolled
   HS256-signing pattern already proven in this codebase
   (`chat/token.ts`'s `signHs256` — no new JWT library dependency). No
   `sub`/user binding, matching the already-decided anonymous/no-login
   access model.
2. On every request under `/live/*`, the Worker:
   - Validates `t` (signature + expiry) before touching the origin at all.
     Invalid/missing/expired → `403`, origin never contacted.
   - On a manifest (`.m3u8`) request: fetches the real manifest from origin
     (via the Tunnel-routed origin binding), and rewrites every segment
     and `EXT-X-KEY` line to append `?t=<same token>`, then returns the
     rewritten text. This is why native Safari HLS and `hls.js` both work
     with zero player-side changes — every URL the client ever sees already
     has the token baked in by the Worker, not the player.
   - On a segment/key request: same token validation, then proxy/cache as
     normal (see Caching below).
3. Token TTL: short enough to bound a leaked/scraped manifest URL's
   usefulness, long enough to cover a full viewing session given
   `VideoPlayer.tsx` fetches `playbackUrl` once per page load with no
   refresh mechanism (same constraint already documented for VOD signing).
   Recommend matching VOD's existing 6-hour TTL for consistency unless
   staging load-testing suggests otherwise.

**Acceptance criteria:** a manifest or segment/key request with a missing,
expired, or tampered `t` gets `403` before any origin bytes are served; a
valid token plays a real stream end-to-end through both `hls.js` and, if
testable, Safari's native path.

## 4. WAF / rate limiting / bot protection (Cloudflare dashboard config, not code)

- Path-scoped Cloudflare Rate Limiting rules, tighter on manifests than
  segments (matching the requested design directly):
  - `*.m3u8` — stricter per-IP threshold (e.g. tens/min — a real viewer
    only re-polls the manifest a handful of times per session; SRS's
    `hls_window`/`hls_fragment` in `infra/srs/conf/srs.conf.template`
    determine the real legitimate refresh cadence, check those values when
    tuning this number in staging).
  - `*.ts` / `*.key` — looser threshold sized to a real viewer's segment
    fetch rate (`hls_fragment 2` seconds as of 2026-08-04 → roughly one
    segment request per 2s per real viewer, plus normal buffering/seek
    bursts — tighter window means more requests/min per viewer than the
    original 4s figure this section was scoped against, size the
    threshold accordingly).
- Cloudflare's standard bot-management heuristics (available on Free/Pro)
  applied to the `stream.<domain>` zone.
- These are Cloudflare dashboard/Terraform config, not application code —
  exact numeric thresholds should be set from real k6 load-test numbers
  (`infra/k6/load-test.js` already exists and has a proven track record in
  this repo of catching real threshold bugs — reuse it against staging
  before picking production values, not guessed cold).

## 5. VOD (R2/S3 signed URLs) — already implemented, not new work here

This part of the original request is already done, ahead of this plan:
`stream_vods.playback_url` stores the bucket key (not a permanent public
URL), and `common/object-storage.ts`'s `getSignedVodUrl` issues a 6-hour
presigned `GetObject` URL per request. The R2 bucket needs no "Public
Access" setting at all. VOD downloads flow directly browser→R2, not through
Cloudflare, so nothing in this plan's Worker/Tunnel work is a dependency
for VOD — it's already independently protected.

Optional future hardening (not required to close the current gap): route
VOD downloads through the same `stream.<domain>` zone too, for one
consistent WAF/rate-limit surface and to avoid exposing the R2 endpoint
hostname directly to clients. Flagged as optional because R2 URLs are
already both time-bound and unguessable (presigned, not a shared secret) —
the marginal benefit is defense-in-depth, not closing an open gap.

## 6. Caching rules

Builds directly on `docs/cdn.md`'s existing, already-verified Cache Rules
(segments long-TTL, manifests short — see that doc for the exact SRS
response-header verification behind those numbers). One addition specific
to this plan: since manifest responses now pass through the Worker and
contain a viewer-specific token, they must be `Cache-Control: no-store` /
Cloudflare "Bypass Cache" — never edge- or browser-cached — not just
short-TTL as `docs/cdn.md` originally suggested, since a cached manifest
would leak one viewer's token to the next.

## 7. Secrets & config management

| Secret | Where it lives | Rotation note |
|---|---|---|
| `HLS_TOKEN_HMAC_SECRET` (new) | Fly secret on `apps/api`; Cloudflare Worker secret (`wrangler secret put`) | Must match on both sides — same dual-write, overlap-window rotation caution as `docs/ROADMAP.md`'s existing Centrifugo-secret item; rotating without an overlap window would 403 every in-flight viewer. |
| Cloudflare Tunnel token | Fly secret on the SRS app | Rotating requires the SRS machine to reconnect; brief connectivity gap expected, not zero-downtime. |
| Cloudflare API token (for Worker/WAF-rule deploys via `wrangler`/Terraform) | Human-held, out of this repo | New Cloudflare account artifact — provisioned by a human, matching `docs/cdn.md`'s own opening line about needing a real account/domain. |

No new secret changes anything about existing `VIDEO_WEBHOOK_SECRET`,
`SRS_RTMP_HOST`, or the RTMP ingest path — this plan is HLS/HTTP-playback
only.

## 8. Staging test plan

Stand this whole thing up against a free-tier Cloudflare test zone (or a
subdomain of a real domain not yet pointed at production) and a staging
copy of the SRS Fly app, **before** touching production DNS. Verification
checklist, in the same "verified live, not just typechecked" style this
codebase already holds itself to elsewhere:

1. Tunnel connects and proxies a real HLS request end-to-end.
2. Direct request to the staging origin's raw `*.fly.dev` hostname fails
   once lockdown is applied.
3. Valid token → manifest returns with every segment/key URI rewritten to
   include the same token.
4. Missing/expired/tampered token → `403` on manifest **and** on
   segment/key requests, confirmed for both request types independently.
5. A real browser (Playwright, same pattern as `apps/e2e`) plays a real
   test stream through `stream.<staging-domain>` with zero console/network
   errors — both the `hls.js` path and, if feasible to force, Safari's
   native-HLS path.
6. `infra/k6/load-test.js` (extended with HLS manifest/segment requests)
   confirms the manifest rate limit trips before the segment rate limit at
   the configured thresholds, and that legitimate single-viewer traffic
   never trips either.
7. `cf-cache-status` header confirms segments serve `HIT` on repeat
   requests, manifests always show `BYPASS`/`DYNAMIC`.
8. Confirm the existing VOD signed-URL flow is unaffected by any of the
   above (independent code path, but worth a regression check given it's
   the other half of "egress protection").

## 9. Rollout plan

1. **Stage 1 — connectivity only.** Deploy Tunnel + Worker + DNS record in
   grey-cloud/DNS-only mode. Zero viewer-facing change; confirms Tunnel
   reachability before any real traffic depends on it.
2. **Stage 2 — parallel path.** Flip the DNS record to proxied, but keep
   the old direct Fly origin URL also reachable. Gate which `playbackUrl`
   `apps/api` returns behind a new boolean env var (e.g.
   `USE_CDN_PLAYBACK_HOST`) rather than a hard cutover — this repo has no
   existing feature-flag system, so a plain env var matches its established
   stub-vs-real-config pattern (same shape as `CHAPA_SECRET_KEY` etc.).
3. **Stage 3 — soak.** Run at partial-then-full traffic for an agreed
   window (48–72h suggested) while watching the Monitoring signals below.
4. **Stage 4 — lock down.** Once stable, remove the SRS app's public
   `[http_service]` exposure for port 8080 (Tunnel-only from here on), and
   delete the old direct-URL code path/env var.

## 10. Monitoring

- Cloudflare's built-in Analytics (requests, cache hit ratio, WAF/rate-limit
  block counts) — free on any plan, no new infra needed.
- Extend the existing Prometheus/Grafana stack
  (`infra/prometheus`, `infra/grafana/dashboards/birq.json`) with a panel
  for Worker error rate / 403 rate once Cloudflare Logpush or the GraphQL
  Analytics API is wired in — note Logpush is a paid feature on some plans,
  so start with the free Analytics dashboard and revisit Logpush only if
  the six-metric admin dashboard's existing "not a full metrics
  reimplementation" philosophy (see `docs/architecture.md`'s Admin
  dashboard section) needs more than that.
- Alert conditions: any traffic still reaching the old direct Fly origin
  after Stage 4 cutover (lockdown bypass), abnormal 403 spikes (broken
  token issuance — check `apps/api` logs first), abnormal 429 spikes
  (rate-limit thresholds too tight for real usage), R2 request/egress
  volume approaching free-tier limits.

## 11. Rollback plan

- DNS: flipping the `stream.<domain>` record back to grey-cloud/direct (or
  back to the plain `*.fly.dev` origin) is a single Cloudflare dashboard
  action — the fastest available rollback.
- The Stage 2 env-var gate means reverting which playback host `apps/api`
  hands out is a config change, not a redeploy, and doesn't require
  re-opening a locked-down origin under incident pressure — this is why
  Stage 4's origin lockdown is deliberately the *last* step, not bundled
  into Stage 2.
- Tunnel/Worker deploys are independently revertible (Cloudflare keeps prior
  Worker versions; `cloudflared` can be stopped without affecting the
  underlying SRS process).

## 12. Cost alerting

- **Cloudflare Workers**: free tier caps at 100k requests/day — estimate
  real request volume (every manifest poll + every segment fetch, per
  concurrent viewer) against that ceiling before going live; Workers Paid
  ($5/mo + usage) is the likely next step once past it. Flag this
  explicitly as a real budget line, not an assumed given.
- **R2**: already free-tier-friendly per `docs/architecture.md`'s backup
  reasoning (10GB storage, no egress fees) — re-check real VOD retention
  (`getVodRetentionDays`) against actual GB-per-VOD once real usage exists,
  since VOD storage volume wasn't part of the original backup sizing.
- **Fly.io**: origin egress should drop substantially once Cloudflare is
  actually absorbing segment traffic via caching — set a Fly billing alert
  (Fly dashboard, human step) as a backstop regardless, matching
  `docs/ROADMAP.md`'s existing "no budget cap or alerting in place" flag
  for this exact gap.

## Consolidated acceptance criteria

- [ ] Direct requests to the Fly SRS origin for `/live/*` are rejected once
      Stage 4 lockdown completes.
- [ ] Every manifest and segment/key request requires a valid,
      non-expired, correctly-signed token; invalid tokens get `403` before
      reaching origin.
- [ ] Manifest responses are never cached at the edge (`no-store`/Bypass);
      segments cache with the long TTL `docs/cdn.md` already specifies.
- [ ] The manifest-path rate limit is strictly tighter than the
      segment-path rate limit, both verified under `infra/k6` load in
      staging before production thresholds are set.
- [ ] VOD playback continues via short-lived signed R2 URLs (already true
      today, regression-checked as part of staging sign-off).
- [ ] Rollback from any stage is a single reversible action, verified in
      staging, not assumed.
- [ ] Cost/usage alerts exist for Workers request volume, R2 usage, and
      Fly egress before Stage 3 soak begins.

## What this plan deliberately does not do yet

Per the instruction this plan was written against: no Cloudflare
account/zone was created, no DNS record was changed, no Worker or Tunnel
was deployed, and no Fly.io configuration was modified. Everything above is
ready to execute once a human provisions the Cloudflare account/domain and
signs off on the Workers-paid-tier possibility called out in Cost alerting.
