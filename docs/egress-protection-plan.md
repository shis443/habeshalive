# Egress protection plan — anonymous public HLS/VOD viewing

**Status, updated 2026-08-05: `birq.live` now exists on Cloudflare (Free
plan, DNS Full setup) and R2 (`birq-vods-production`) — the account/domain
blocker below is resolved.** Waiting on a scoped API token to actually
execute §1-2/§4 (DNS records, Tunnel, WAF rules). §3 (viewer-session
tokens) is **partially implemented in code already**: the API-side token
minting (`apps/api/src/streams/hls-token.ts`) and the Worker itself
(`infra/cloudflare-worker/`) are both written and typechecked — see those
sections below for what's real vs. still needs a live deploy to verify.
No DNS changes, no Tunnel, no Worker deploy, no WAF/rate-limit rules have
been executed yet. This still scopes what `docs/ROADMAP.md`'s "Deferred by
deliberate choice" item and `docs/SECURITY.md`'s known-accepted-risk #4
call for — the vendor/account decision is now resolved, execution isn't.

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

**Implemented 2026-08-05, not yet deployed/verified live:**
`apps/api/src/streams/hls-token.ts` (token minting) and
`infra/cloudflare-worker/src/worker.ts` (token enforcement + manifest
rewrite) — both typecheck clean. What's below is the design those
implement; deployment steps are in
`infra/cloudflare-worker/README.md`.

**Design choice — rewrite the manifest at the edge, don't rely on the
player forwarding query strings.** SRS writes one shared, static `.m3u8`/
`.ts` file set per stream (not personalized per viewer — this deployment
doesn't have `hls_keys`/AES enabled, see `infra/srs/conf/srs.conf.template`,
so there's no `.key` file to account for either), and this app's
`VideoPlayer.tsx` falls back to Safari's *native* HLS engine for some
clients — which has no hook for attaching a token to each derived segment
request the way `hls.js`'s `xhrSetup` could. Relying on client-side
propagation would mean two different, unverified code paths. Instead, the
Worker does the propagation itself:

1. `toStreamDetail` in `apps/api/src/streams/service.ts` — the single
   shared mapping function every stream-detail read goes through
   (`listLiveStreams`, `getStreamById`, `getLiveStreamByUsername`, the
   admin listing) — calls `appendHlsToken(row.playback_url,
   row.creator_id)` on every read. **Deliberately not** done inside
   `videoProvider.getPlaybackUrl` (which only runs once, at go-live time,
   to build the *stored* `streams.playback_url` value): a live stream can
   run for hours, so a token baked in once at go-live would expire while
   the stream is still live. Signing fresh on every read is the same
   pattern `vods/service.ts`'s `getSignedVodUrl` already uses for VOD.
   Token = HS256 JWT-shaped payload `{ streamId, exp }` (`streamId` is the
   creator's userId — the same identifier already used in the URL path,
   not the internal DB row id, so the Worker can cross-check the token
   against the specific stream being requested), signed with a **new**
   dedicated secret (`HLS_TOKEN_HMAC_SECRET`), reusing the exact
   hand-rolled HS256-signing pattern already proven in this codebase
   (`chat/token.ts`'s `signHs256` — no new JWT library dependency). No
   `sub`/user binding, matching the already-decided anonymous/no-login
   access model. No-op (URL unchanged) until `HLS_TOKEN_HMAC_SECRET` is
   set — safe to have shipped ahead of the Worker, since SRS's static file
   server ignores the extra query param.
2. On every request under `/live/*`, the Worker:
   - Validates `t` (signature + expiry + that its `streamId` claim matches
     the requested path) before touching the origin at all.
     Invalid/missing/expired/mismatched → `403`, origin never contacted.
   - On a manifest (`.m3u8`) request: fetches the real manifest from
     origin, rewrites every segment line to append `?t=<same token>`, sets
     `cache-control: no-store` (a manifest is per-viewer now — must never
     be cached), and returns the rewritten text. This is why native Safari
     HLS and `hls.js` both work with zero player-side changes — every URL
     the client ever sees already has the token baked in by the Worker,
     not the player.
   - On a segment request: same token validation, then pass through
     unchanged so Cloudflare's Cache Rules (`docs/cdn.md`) still apply —
     the Worker never buffers or rewrites segment bytes.
3. Token TTL: 6 hours, matching VOD's `getSignedVodUrl` — long enough to
   cover a full viewing session given `VideoPlayer.tsx` fetches
   `playbackUrl` once per page load with no refresh mechanism, short
   enough to bound a leaked/scraped manifest URL's usefulness. Revisit if
   staging load-testing suggests otherwise.

**Acceptance criteria (unverified — no live Cloudflare deploy yet):** a
manifest or segment request with a missing, expired, or tampered `t` gets
`403` before any origin bytes are served; a valid token plays a real
stream end-to-end through both `hls.js` and, if testable, Safari's native
path. See `infra/cloudflare-worker/README.md`'s verification steps.

## 4. WAF / rate limiting / bot protection (Cloudflare dashboard config, not code)

- Path-scoped Cloudflare Rate Limiting rules, tighter on manifests than
  segments (matching the requested design directly):
  - `*.m3u8` — stricter per-IP threshold (e.g. tens/min — a real viewer
    only re-polls the manifest a handful of times per session; SRS's
    `hls_window`/`hls_fragment` in `infra/srs/conf/srs.conf.template`
    determine the real legitimate refresh cadence, check those values when
    tuning this number in staging).
  - `*.ts` — looser threshold sized to a real viewer's segment
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
- [ ] Every manifest and segment request requires a valid,
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

## What's real vs. still pending, as of 2026-08-05

**Real, deployed to production**: the Cloudflare account and `birq.live`
domain exist (Free plan, proxied DNS), R2 bucket `birq-vods-production`
exists and its credentials are already set as Fly secrets. `apps/api`'s
HLS token minting (`streams/hls-token.ts`, wired into every stream-detail
read) is deployed to production but dormant (`HLS_TOKEN_HMAC_SECRET`
unset).

**Real code, not yet deployed**: the Cloudflare Worker
(`infra/cloudflare-worker/`) — written, typechecked, needs `wrangler
deploy` against a real API token.

**Not started**: no DNS record for `stream.<domain>`/`ingest.<domain>`
exists yet (confirmed — still to do), no Tunnel, no WAF/rate-limit rules,
no origin lockdown, no cost alerts. Waiting on a scoped Cloudflare API
token (Zone:DNS:Edit, Zone:SSL and Certificates:Edit, Zone:Cache
Rules:Edit, Zone:Firewall Services:Edit, Account:Cloudflare Tunnel:Edit,
Account:Workers Scripts:Edit) to execute the rest of this plan.
