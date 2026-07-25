# Architecture

This describes the system as it actually runs — one narrative, kept in sync
with `docker-compose.yml`. There is no separate "future migration" plan for
video hosting; self-hosted SRS is the answer, not a placeholder for one.

## Topology

```
                         ┌──────────┐
   OBS Studio ──RTMP────▶│ HAProxy  │
  (creator's app)        │(infra/   │
   viewer  ──HLS─────────▶ haproxy) │
   (hls.js)               └────┬────┘
                    ┌──────────┴──────────┐
                    ▼                     ▼
              ┌──────────┐          ┌──────────┐
              │  srs-1   │◀────────▶│  srs-2   │   (N nodes; add more by
              │ (SRS)    │  shared  │ (SRS)    │    extending both this and
              └────┬─────┘  volume  └────┬─────┘    haproxy.cfg's backends)
                   │      (srs_hls_data)      │
                   │ HTTP callback (on_publish / on_unpublish)
                   ▼
                         ┌─────────────┐        ┌──────────────┐
                         │  apps/api   │───────▶│  PostgreSQL  │
                         │  (Fastify)  │        └──────────────┘
                         └──────┬──────┘        ┌──────────────┐
                                │               │  Redis        │
                                │               └──────────────┘
                                │               ┌──────────────┐
                                └──────────────▶│  Centrifugo   │ (chat pub/sub)
                                                 └──────────────┘
```

`apps/web` talks to `apps/api` over HTTP for everything except live chat,
which connects to Centrifugo directly from the browser.

## Video pipeline (SRS)

- **Ingest**: creators point OBS at `rtmp://<SRS_RTMP_HOST>/live/<stream_key>`,
  which resolves to HAProxy's `1935` frontend, TCP-load-balanced (round
  robin) across the SRS nodes. The stream key is generated locally when a
  creator first requests one (`GET /streams/key`) — SRS needs no
  provisioning API call the way a managed provider would; any RTMP stream
  name just works.
- **Multi-node HLS**: a given RTMP publish always lands on exactly one SRS
  node (inherent to a single TCP connection), but HAProxy's HLS frontend
  (`8080`, HTTP mode, `balance uri`) makes an independent per-request
  routing decision that can land on a *different* node. To make that safe,
  every SRS node mounts the same `srs_hls_data` Docker volume as its HLS
  output dir, so any node can serve any live stream's segments regardless
  of which node ingested it. (SRS's own `origin_cluster`/`coworkers`
  feature was tried first since it looks purpose-built for this — it
  parses and boots fine, but only relays RTMP/HTTP-FLV *play* requests via
  redirect, not static HLS file serving, so it didn't fix anything here.
  Verified live both ways: 404 with `coworkers` alone, consistent 200s
  with the shared volume. See `infra/haproxy/haproxy.cfg` for the full
  writeup.)
- **Output**: SRS transmuxes the incoming RTMP to HLS automatically and
  serves it over its own HTTP server at
  `http://<SRS_HTTP_HOST>/live/<stream_key>.m3u8` (via HAProxy). `apps/api`
  constructs this URL itself (`videoProvider.getPlaybackUrl`) — SRS's
  callbacks don't send a playback URL back.
- **Callbacks**: SRS calls `POST /streams/webhooks/live-started` on publish
  and `POST /streams/webhooks/live-ended` on unpublish (configured in
  `infra/srs/conf/srs.conf.template`, `vhost.http_hooks`). The payload is
  SRS's own shape (`{ action, stream, app, vhost, param, ... }`); only
  `stream` (the stream key) is used. SRS can't send custom headers on these
  calls, so the webhook secret travels as a `?secret=` query param instead
  of the `x-webhook-secret` header other callers use — both are accepted.
- **Player**: `apps/web`'s `VideoPlayer` component uses `hls.js` against
  whatever `playback_url` the API returns, with a native-HLS fallback for
  Safari.

See `infra/srs/README.md` for port numbers, the config-templating mechanism,
and a security note about the vendored SRS source clone.

## Observability

Prometheus (`:9090`) scrapes six targets every 15s, all verified live (each
one checked at `/metrics` directly before being wired into scrape config,
then confirmed `up` in Prometheus's own target list):

- `apps/api` exposes `/metrics` via `prom-client` — default Node.js process
  metrics, `http_request_duration_seconds`/`http_requests_total` (labeled by
  route pattern, not raw URL, to avoid per-ID cardinality blowup), and
  `streams_live_total` (a live DB count, not a cached value).
- HAProxy's own built-in exporter (`:9101`, native since 2.0 — no sidecar)
  gives per-backend/per-server up/down status and request counts.
- Each SRS node's own built-in exporter (`:9972`, native since v5.0.67 —
  confirmed against `infra/srs/vendor/trunk/doc/CHANGELOG.md`) gives
  `srs_streams`/`srs_clients`/`srs_cpu_percent`/`srs_memory` per node.
- `postgres-exporter` (prometheus-community) and `redis-exporter`
  (oliver006) — both standard, widely-used images, not custom code.

Grafana (`:3001`, `admin` / `GRAFANA_ADMIN_PASSWORD` env var) auto-provisions
the Prometheus datasource and a starter dashboard
(`infra/grafana/dashboards/habeshalive.json`) covering live streams, SRS
viewers/streams per node, HAProxy backend health, API request rate/p95
latency, Postgres connections, and Redis memory. Every panel query was
checked against the exporter's real metric names before being written in —
e.g. HAProxy's per-server status metric is `haproxy_server_status{proxy,
server, state}`, not the more guessable `haproxy_server_up`.

## Backups

`infra/backup` (built as the `backup` service) runs `pg_dump | gzip`, uploads
to a Cloudflare R2 bucket (`habeshalive-backups`, S3-compatible, via the `mc`
client pointed at R2's endpoint — see `.env.example`'s `BACKUP_S3_*` vars),
and prunes objects older than `BACKUP_RETENTION_DAYS` (default 14). It runs
once immediately on container start — verified live: a fresh
`docker compose up` produces a real, valid `.sql.gz` in the bucket within
seconds, not after waiting for the first scheduled run — then settles into a
nightly schedule at `BACKUP_HOUR_UTC` (default 02:00 UTC), computed with
plain arithmetic on `date -u` fields since the image's shell is busybox ash
(no GNU `date -d` / BSD `date -v`). R2 replicates data across multiple
locations by default (unlike the single-node MinIO container this replaced),
so there's no equivalent multi-node caveat here. R2's free tier covers 10GB
storage and has no egress fees, which is what makes it a reasonable fit for
this at demo/small scale rather than a paid bucket.

Separately: this backup mechanism only runs where `docker-compose.yml` runs
(local/single-host). The production API on Fly.io does not run the `backup`
service — production's actual data-loss protection today is whatever Neon
(the managed Postgres provider) does on its own (point-in-time recovery on
its free tier, typically a multi-day window). Wiring a scheduled production
backup of the Neon database into R2 is a separate, not-yet-done task.

## Auth

Two independent sign-in channels, same mechanism (6-digit code, 5-minute
expiry, 30s resend cooldown, both rate-limited per-identifier — see the
Rate limiting section below): phone OTP (`POST /auth/request-otp` /
`/verify-otp`, the original flow) and email OTP
(`/auth/request-email-otp` / `/verify-email-otp`, added later).

**Phone (SMS) delivery is still a stub** — `apps/api/src/auth/sms-gateway.ts`
just console.logs the code, no real Ethiopian SMS gateway wired up.

**Email delivery is real** when `RESEND_API_KEY` is set —
`apps/api/src/auth/email-gateway.ts`'s `ResendEmailGateway` calls
Resend's actual `POST /emails` API (contract verified against Resend's
own docs, same pattern as the Chapa integration: endpoint, auth header,
required fields, and the response shape checked before writing any code).
With the key unset (the local-dev default), it falls back to the same
console-log stub the SMS gateway uses. Verified live, not just
typechecked: a deliberately-invalid test key produced a real 401 from
Resend's actual API (`{"name":"validation_error","message":"API key is
invalid"}`), and the application code correctly surfaced that exact
message through a real HTTP request/response cycle (`500`, logged
server-side as `"Resend send failed: 401 API key is invalid"`) rather
than either crashing unhandled or silently succeeding — confirming the
integration itself is correct; a real `RESEND_API_KEY` is the only thing
missing to actually deliver mail. `RESEND_FROM_EMAIL` defaults to
Resend's sandbox sender (`onboarding@resend.dev`), which sends
successfully with zero domain-verification setup — switch it to a
verified domain's address once one exists.

`otp_codes` has one row shape for both: `phone_number`/`email` are each
nullable with a CHECK constraint requiring exactly one set
(`db/migrations/0009_email_otp.sql`). The user-lookup-or-create-with-wallet
logic (`findOrCreateUser` in `auth/service.ts`) is shared between both
verify paths rather than duplicated — it's the one part that touches
money (provisioning a wallet for a new account), so writing it twice
risked the two copies drifting.

**Known limitation, not implemented**: no account linking. A user who
signs up by phone and one who signs up by email with the same person
behind both get two separate accounts — there's no "is this email
already tied to an existing phone account" check. Real account linking
(prompt to link, merge wallets/history) is a materially bigger feature
than "add email as a sign-in option" and wasn't in scope here.

The web app's `LoginForm` has a Phone/Email toggle at the identifier
step; `POST /api/session` (the Route Handler that exchanges a verified
code for a session cookie) detects which one the request body is by
checking for an `email` vs `phoneNumber` field and forwards to the
matching upstream endpoint. Verified live end-to-end through the actual
browser UI (not just the API): toggle switches the visible field, a real
OTP requested and scraped from `docker logs` (same no-backdoor pattern as
the phone E2E tests), wrong-code correctly rejected, reused-code
correctly rejected, and a real user + wallet row confirmed in Postgres
after signup — see `apps/e2e/tests/email-login.spec.ts`.

## Data model

Money is always integer `santim` (birr cents), never floats. Every economic
event (top-up, gift, subscription, payout) is a double-entry
`ledger_transactions` row with balanced `ledger_entries` — see
`db/schema.sql`, and `apps/api/src/wallet/service.test.ts` for the ledger
invariants under test.

## Payments (Chapa)

Top-up checkout-initialization is real, not a stub, when `CHAPA_SECRET_KEY`
is set: `apps/api/src/wallet/chapa-client.ts`'s `RealChapaClient` calls
Chapa's actual `POST /v1/transaction/initialize` (contract verified against
Chapa's own docs, not memory — see the comment in that file). With the key
unset (the local-dev default), it falls back to a stub checkout URL so
nothing else needs a real account to run.

The webhook (`POST /wallet/webhooks/chapa`) verifies Chapa's
`x-chapa-signature` header — HMAC-SHA256 of the *raw* request body (not a
re-serialization of the parsed JSON, which could reorder keys) using
`CHAPA_WEBHOOK_SECRET`, compared with `timingSafeEqual`. Verified live both
ways: a request signed with the configured secret reaches the business
logic (confirmed via its actual downstream error, "Unknown top-up
reference," for a made-up `tx_ref`), an incorrectly-signed one is rejected
with 401. With `CHAPA_WEBHOOK_SECRET` unset, the route refuses with 501
rather than silently accepting — that's a real vulnerability class
(unauthenticated wallet credits) worth failing loudly on, not falling back
quietly on.

### Payout disbursement

Real, not simulated, when `CHAPA_SECRET_KEY` is set — contract verified
against Chapa's own Transfer docs (`POST /v1/transfers`,
`GET /v1/banks`), same pattern as checkout-init above. `requestPayout`
(`apps/api/src/wallet/service.ts`) reserves the funds in the ledger
immediately (debit creator, credit platform — that part is our own
bookkeeping, always synchronous), then:

- **Below the manual-review threshold** (5,000 ETB): attempts the Chapa
  transfer immediately. If Chapa's API call itself fails to even start
  (network error, rejected request), the ledger reservation is reversed in
  the same request (a `refund`-type ledger transaction credits the creator
  back) and the client gets a clear 502 — money is never silently stuck
  debited with no transfer in flight.
- **At/above the threshold**: stays `pending_review`, no Chapa call yet,
  until `POST /wallet/payouts/:id/approve` (admin-only, enforced by a new
  `app.requireAdmin` decorator reading `role` off the JWT — verified live
  that a non-admin gets 403 and an admin gets through).
- **Either path**, once Chapa actually attempts the transfer: its
  transfer-status webhook (`POST /wallet/webhooks/chapa-transfer`, same
  `x-chapa-signature` verification as the topup webhook) marks the payout
  `paid` or, on failure, reverses the ledger and marks it `failed` with a
  reason.

"telebirr" payouts resolve their `bank_code` by name lookup against
Chapa's real bank directory rather than a hardcoded guess (there's no
confirmed stable code without a live account to check against); "bank"
payouts require the client to supply one directly (`requestPayoutSchema`'s
`.refine()` — a bank payout without it is a 400, verified live). All of
the above — auto-process, manual-review hold, admin approval, non-admin
rejection, webhook completion, and the missing-bankCode validation — was
exercised against the running stack with real HTTP requests and minted
JWTs, not just typechecked.

Migration: `db/migrations/0005_payout_disbursement.sql` adds `bank_code`,
`chapa_reference`, `failure_reason` to `payouts`.

## Rate limiting

`@fastify/rate-limit` with an `ioredis` store (`apps/api/src/common/redis.ts`),
so limits hold across API instances, not per-process. A generous global
default (300/min/IP, `skipOnError: true` — a Redis blip shouldn't take
every route down with it) applies everywhere, with tighter per-route
overrides:

- `POST /auth/request-otp`: 3 per 5 min, `POST /auth/verify-otp`: 5 per
  5 min — both keyed by **phone number** (parsed from the body at the
  `preHandler` stage, not IP), since the abuse they guard against
  (SMS-bombing a number, brute-forcing its OTP) is per-number regardless
  of how many IPs an attacker rotates through. Both override
  `skipOnError: false` — for these two specifically, failing closed during
  a Redis outage beats silently allowing unlimited sends/brute force.
  Verified live: the 4th `request-otp` and 6th `verify-otp` for the same
  number both got a real 429 from this limiter (distinct from — and on
  top of — the app's pre-existing 60s resend cooldown, confirmed as a
  separate mechanism by its different error message), and the Redis key
  it created (`habeshalive-rl:POST/auth/verify-otp-phone:+251...`) was
  checked directly with `redis-cli KEYS`, not just inferred from the HTTP
  response.
- `POST /wallet/gifts`: 30/min, `POST /wallet/topups`: 10/hour,
  `POST /wallet/payouts`: 10/hour — all IP-keyed (the plugin default), not
  user-keyed. These routes already have `preHandler: app.authenticate`,
  and the rate-limit plugin injects its own check at the same
  (`preHandler`) lifecycle stage — their relative execution order isn't
  something to depend on, so keying by `req.user.sub` here risked silently
  keying everyone by `undefined` if the limiter's hook happened to run
  first. IP-based still stops scripted abuse without that risk.

**Not covered: chat.** There is no backend chat-send endpoint to rate-limit
— `ChatPanel.tsx` only appends to local React state (`INITIAL_MESSAGES`,
hardcoded seed data) and was never actually wired to Centrifugo, despite
Centrifugo running in the stack and `CENTRIFUGO_*` env vars already
existing. That's a real, separate gap (chat isn't real yet, not just
unlimited) — worth flagging plainly rather than inventing a rate limit for
an endpoint that doesn't exist.

## Moderation queue

`apps/api/src/moderation/` scans user-generated text against a blocklist
and, on a match, **flags it for human review — it never blocks or deletes
the content itself**. `moderation_flags` (`db/migrations/0006_moderation.sql`)
records the match; `GET /moderation/queue` and
`POST /moderation/queue/:id/resolve` (both `app.requireAdmin`) let an admin
mark a flag `approved` or `removed` — "removed" records the moderator's
decision but doesn't itself mutate the original stream/gift, which would
need separate follow-up action; this is a review queue, not an auto-mod.

Wired into the two real user-text endpoints that exist today:
`POST /streams/go-live` (title) and `POST /wallet/gifts` (optional
message). Verified live: an offending gift message and an offending
stream title both produced a real `moderation_flags` row with the correct
matched terms, a non-admin got 403 on the queue endpoints, resolving a
flag twice correctly 404'd the second time, and a clean message produced
no flag.

**Blocklist content** (`apps/api/src/moderation/wordlists.ts`): a small
illustrative English list, checked before writing against
[LDNOOBW's multilingual list](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
(28 languages) to see if a credible Amharic list already existed —
**it doesn't**. Rather than invent Amharic slurs/harassment terms from
memory, `AM_BLOCKLIST` ships empty; that's a real gap needing a
native-speaker-reviewed list, not a silently "good enough" placeholder.
Matching is word-boundary based (`scanText`), so it catches "bastard" but
not "fucking" (no boundary after "fuck" mid-word) — a known, common
limitation of naive blocklists (the alternative, substring matching, trades
this for false positives like "classic" containing "ass" — the Scunthorpe
problem), not something this pass tried to solve.

**Not covered: chat** — same reason as the rate-limiting section above:
there's no chat-send endpoint to flag from yet.

## Reports, bans, and appeals

Distinct from the automated blocklist above: `reports` are user-submitted
(`POST /moderation/reports`, any authenticated user — target a stream,
user, or gift message with a reason + optional details), reviewed by an
admin (`GET /moderation/reports`, `POST /moderation/reports/:id/resolve`
with `status: actioned | dismissed`). "Actioned" records the decision, it
doesn't itself do anything automatic — an admin separately calls
`POST /moderation/actions/ban` to actually ban the reported user.

`moderation_actions` existed in the schema from the very first migration
but had no code ever writing to it until this pass — `banUser`/`unbanUser`
(`apps/api/src/moderation/actions-service.ts`) are the first real
callers, each writing a real audit row (`actor_id`, `target_user_id`,
`action`, `reason`) alongside flipping `users.is_banned`.

**Enforcement** (`app.rejectIfBanned` in `apps/api/src/app.ts`) is
deliberately *not* folded into the generic `authenticate` decorator —
doing that would make `POST /moderation/appeals` itself unreachable for
banned users, the one thing they specifically need to still be able to
do. Instead it's an explicit second preHandler
(`preHandler: [app.authenticate, app.rejectIfBanned]`) applied only to
the sensitive write routes: gifts, topups, payouts, go-live. A banned
user can still hit any other authenticated route (verified live:
`GET /wallet/balance` returned 200 for a banned user) — just not spend
money or publish content.

A banned user appeals via `POST /moderation/appeals` (rejects with 400 if
not currently banned, and if they already have a pending appeal — one at
a time). An admin resolves it
(`POST /moderation/appeals/:id/resolve`, `approve` or `deny`); approving
calls `unbanUser` internally, so the ban actually lifts as part of
resolution, not as a separate manual step. Verified live end-to-end:
report submitted → resolved actioned → user banned → `go-live` 403's for
that user → user still authenticates fine elsewhere → appeal submitted →
duplicate appeal while pending correctly 400's → admin approves → `go-live`
succeeds again → `moderation_actions` has both the `ban` and `unban` rows
with the real actor/reason.

## Search

`GET /search?q=...` (`apps/api/src/search/`) — the `/search` page existed
before this pass but was a placeholder ("Search isn't wired to real
results yet"); it now renders real server-rendered results.

Postgres full-text search, not a separate search service — generated
`tsvector` columns on `streams` (title + category) and `users`
(username + display\_name + bio), both `'simple'` config rather than
`'english'`: English's stemming/stopword list would silently mishandle
Amharic (Ge'ez script) text in titles/bios, a real and expected case
here, not a hypothetical one. GIN indexes on both
(`db/migrations/0008_search.sql`).

Prefix matching (`buildPrefixTsQuery` in `search/service.ts`) rather than
whole-lexeme matching — `to_tsquery`/`websearch_to_tsquery` alone only
match complete words, which would make "gam" not find "Gaming" or
"dawit\_gamer" and break search-as-you-type. Verified live: querying `gam`
returned both the stream (title "Gaming Marathon Tonight") and the
creator (username `dawit_gamer`, bio containing "gaming"); a
username-only match (`dawit`) correctly returned the creator but no
stream (title didn't contain it); a no-match query and an empty query
both returned `{streams: [], creators: []}` cleanly; and the actual
`/search` page HTML (not just the API) was checked for each case.

Streams search only returns `status = 'live'` (no point surfacing ended
streams to search from the live-platform UI); creators search is scoped
to `role = 'creator'` via a join on `creator_profiles`.

## Admin dashboard

`apps/web/app/admin/page.tsx` — server-rendered, gated on
`getCurrentUser().role === "admin"` (redirects everyone else to `/`,
verified live: a viewer's session cookie against `/admin` got a real 307
to `/`). Pulls together everything the sections above built:

- Six summary counts from `GET /admin/summary` (`apps/api/src/admin/`) —
  real DB counts (pending payouts, flagged content, open reports, pending
  appeals, live streams, total users), one query each, no caching (this
  is a human glancing at a dashboard, not a hot path).
- Pending payouts (`GET /wallet/payouts/pending`, added alongside this —
  the approve endpoint existed from section B but nothing could list what
  was waiting) with an Approve button.
- The four review queues from the Safety & Moderation sections above
  (flagged content, reports, appeals) with their real resolve actions.
- A link out to Grafana (`NEXT_PUBLIC_GRAFANA_URL`, defaults to
  `localhost:3001`) for anything more detailed than the six counts —
  this page doesn't reimplement a metrics dashboard, Grafana already is
  one.

Action buttons go through `/api/backend/...` (the existing authenticated
proxy — client components can't read the httpOnly session cookie, so
mutations from `AddFundsRow`/`GiftModal`/etc. already routed through this
same proxy before this pass) and `router.refresh()` afterward, the same
pattern as the rest of the app — no new client-side data-fetching
mechanism introduced for this page.

Verified live end-to-end through the actual proxy path (not the API
directly): promoted a test user to admin, hit `/admin` with a real session
cookie and saw all sections render (including correct empty states),
created a real flagged gift message, confirmed it appeared on the page,
resolved it via `POST /api/backend/moderation/queue/:id/resolve` (the
exact URL the Remove button calls), and confirmed a fresh page load no
longer showed it.

## PWA

`app/manifest.ts` uses Next.js's native manifest generation (auto-injects
`<link rel="manifest">` — confirmed in the actual served HTML `<head>`, no
config beyond the file existing). Icons are generated at request time via
`next/og`'s `ImageResponse` (`app/icon.tsx` for the browser tab favicon,
`app/icons/192` and `/512` route handlers for the manifest's PWA sizes) —
real PNGs, not placeholder files (verified: correct `image/png`
content-type, non-trivial byte sizes, and the actual rendered image
visually checked).

The service worker (`public/sw.js`) is hand-rolled, not
[`next-pwa`](https://www.npmjs.com/package/next-pwa) — checked
`npm view next-pwa peerDependencies time.modified` before deciding:
last published 2022-08, `next: >=9.0.0` as its only constraint (no upper
bound, no confirmed App Router testing), years before this app's Next.js
version. Pulling in an unmaintained dependency against a framework
version it was never tested with was judged riskier than hand-rolling the
~60 lines this actually needs. It does exactly one real thing: network
requests pass through normally, but a failed *navigation* (not API calls —
those are explicitly excluded so nothing serves stale wallet balances or
chat) falls back to `public/offline.html` instead of the browser's blank
error page. Static assets get simple cache-first. Registered via
`components/ServiceWorkerRegister.tsx`, a client component mounted in the
root layout.

## Testing

Two layers, not one, and they're not redundant with each other:

- **Unit/integration** (`apps/api/src/wallet/service.test.ts`, Vitest) —
  the ledger invariants: every economic event balances, idempotent
  webhook retries, insufficient-balance rejection. Runs against the same
  Postgres this whole stack uses, no mocking of the database.
- **E2E** (`apps/e2e`, Playwright, `npm run test -w apps/e2e`) — real
  browser, against the actually-running `docker compose` stack (not a
  server Playwright spins up itself — this is 13 containers, there's no
  single "start command" to hand it). Covers: homepage renders, the PWA
  manifest is served, search's query/no-match/empty states, a **real**
  phone+OTP signup completing end to end (code scraped from
  `docker logs` — see `tests/utils/otp.ts` for why: the dev SMS gateway
  only console.logs, deliberately with no app-level test bypass/backdoor),
  wrong-OTP rejection, an authenticated user's real wallet balance
  rendering, anonymous/non-admin redirects, and an admin (promoted via
  direct DB write in `tests/utils/db.ts` — there's no self-service
  promote-to-admin API, nor should there be) seeing the real dashboard
  queues from section D3.

Both were actually run, twice each for the E2E suite specifically to
check for flakiness under Playwright's parallel workers — the first run
caught two real bugs worth recording, not glossing over:
1. An ambiguous test selector (`"0.00 ETB"` matched both the balance and
   the weekly-delta text) — a bug in the test, not the app.
2. Timestamp-derived phone numbers (`Date.now()` millisecond suffix)
   collided across parallel workers starting within the same millisecond,
   tripping the real OTP resend cooldown/C1 rate limiter — fixed by
   adding a random component (`uniquePhoneSuffix` in `tests/utils/auth.ts`).
   Both fixes are in the test utilities, not the application code.

### CI

`.github/workflows/ci.yml` — three jobs (`typecheck`, `unit-tests` against
a bare Postgres service container, `e2e` against the real
`docker compose up -d --build` stack, curl-polled for readiness before
migrating and running Playwright). **Not yet actually run**: this repo
has no git remote, so nothing has triggered it — that's an external
blocker (creating/pushing to a remote needs separate confirmation, not
something to do silently), not a gap in the workflow itself. What *was*
verified without needing a remote: every command the workflow runs was
run for real against this exact repo state (`npm ci --dry-run` confirms
the lockfile is in sync, `npm run typecheck`, `node db/migrate.mjs`,
`npm run test --workspace=apps/api`, the full `docker compose up -d`
boot, and the Playwright suite all passed, per this section and the
sections above), and the YAML itself was parsed with `js-yaml` to catch
syntax errors — this is the same level of confidence as "should pass in
CI," just not literal proof from CI's own runner.

## Security scanning & load testing

Both were run for real against the live `docker compose` stack, not
configured-but-unrun — and both caught genuine bugs that got fixed as
part of this pass, not just clean passes to report.

### k6 (`infra/k6/load-test.js`, `k6 run infra/k6/load-test.js`)

Ramps to 20 VUs hitting the real read paths (streams/live, search,
gift-types, the homepage) for 2 minutes. First run: **73% failure rate**.
Investigation (not just re-running and hoping) found two distinct real
bugs, not one:

1. A single load-test client is a single source IP, and apps/api's
   global rate limiter (section "Rate limiting" above) is IP-keyed —
   inherently going to look like one very aggressive client at k6's
   request rate. Not a bug by itself; the test script originally
   conflated this with real failures, fixed by counting 429s separately
   from actual server errors (`server_errors` custom metric, `count==0`
   as the real correctness threshold).
2. **The real bug**: with that separated out, there were still 2,840 (23%
   of requests) genuine 500s. Root cause: `apps/web/lib/api.ts`'s
   `getCurrentUser()` — called on nearly every page for the nav bar's
   auth state — threw on any non-200 response from the API, including a
   transient 429. An uncaught throw in a Next.js Server Component
   crashes the whole page render, so a rate-limited *internal* API call
   (the web container calling the API server-to-server, see the Rate
   limiting section's explanation of why that's a shared bucket across
   all real visitors) took down the entire site for every visitor, not
   just whoever/whatever triggered the spike. Fixed two ways, not one:
   - Every function in `lib/api.ts` now degrades to a safe default
     (`null`, `[]`, or a zeroed object matching its schema) on a
     non-200 response instead of throwing — except `getAvatarParts`,
     deliberately left throwing (no safe empty manifest to degrade to,
     and it's a single low-traffic opt-in page, not something on every
     visitor's path).
   - The global rate limit itself was raised from 300/min to 2000/min
     (`apps/api/src/app.ts`) — 300 was simply too low for legitimate
     aggregate traffic sharing one IP through the web tier.

   Re-ran after both fixes: **0 server errors, 100% checks passed**,
   p95 latency 103.9ms, with rate-limited (429) responses still present
   (7.9%, correctly excluded from the failure count) confirming the
   limiter itself still works.

   A related but separate bug surfaced investigating this: `wallet/routes.ts`'s
   gifts/topups/payouts rate limits were **IP-keyed by default**, which —
   since those routes are also called through the web app's
   `/api/backend` proxy, server-side, from the same one fixed container
   IP — meant every real user's gift-sending, top-ups, and payout
   requests shared **one rate-limit bucket for the entire platform**, not
   one per user. Fixed by keying on the authenticated user ID instead
   (`keyByUser` in `wallet/routes.ts`), which requires
   `hook: "preHandler"` on the route's `rateLimit` config — the plugin's
   default hook (`onRequest`) runs before `app.authenticate` populates
   `req.user`. This wasn't left as an assumption: verified live by
   exhausting one user's 30-request/minute `/gifts` limit, then
   immediately hitting the same route as a second user from the same
   source IP — the second user was unaffected, proving the bucket is
   genuinely per-user.

### OWASP ZAP baseline (`ghcr.io/zaproxy/zaproxy:stable zap-baseline.py`, `infra/zap/`)

Run against `http://web:3000` (both containers on the same Docker
network, no host-networking tricks needed). First run: 0 FAIL, 9 WARN —
all missing security headers (clickjacking, X-Content-Type-Options,
CSP, Permissions-Policy, X-Powered-By leaking Next.js). Fixed in
`apps/web/next.config.mjs`: `poweredByHeader: false` and a `headers()`
config adding X-Content-Type-Options, X-Frame-Options, Permissions-Policy,
and a real CSP — not a copy-pasted generic one: it explicitly allows the
API's origin in `img-src`/`connect-src` because avatar images and two
client-side fetches (`LoginForm`'s request-otp call,
`AddFundsRow`'s dev-only simulate-payment call) are genuinely
cross-origin (API on a different port than the web app). Verified this
didn't silently break anything, not just typechecked: a real headless
browser (Playwright) loaded the homepage, login, search, and a watch
page with zero CSP console violations, and a direct cross-origin fetch
of a real avatar image succeeded (`naturalWidth: 200`, not blocked).

Re-ran after the fix: WARN count dropped to 5. Remaining, each a
conscious decision rather than an oversight:
- `script-src 'unsafe-inline'` — Next.js's own hydration bootstrap needs
  inline script execution; a nonce-based CSP would remove this but needs
  per-request nonce generation wired through middleware, a bigger change
  than this pass had room to implement *and* verify safely.
- Cross-Origin-Embedder-Policy missing — deliberately not added: COEP
  (`require-corp`) would require the cross-origin avatar images to carry
  matching CORS/CORP headers from the API or it'd break the exact image
  loading just verified above. Not worth the risk for a header whose
  main purpose (enabling `SharedArrayBuffer`/high-res timers) this app
  doesn't need.
- "Big Redirect Detected," "Non-Storable Content," "Modern Web
  Application" — informational-only ZAP findings, not real issues
  (redirects to auth-gated pages, dynamic content correctly not cached,
  and "this is a JS-heavy app" respectively).

**Also attempted against the API** (`http://api:4000/health`) **— genuinely
inconclusive, not silently dropped.** ZAP's baseline scan is a spider-based
tool built for HTML pages with links to crawl; pointed at a bare JSON
health-check endpoint with nothing to spider, it hung for 37+ minutes with
zero log output and had to be killed rather than left running
indefinitely. No `zap-api-report.html` exists because of this — that's an
honest gap, not a clean scan being claimed. The API's actual
security-relevant behavior was instead verified directly and repeatedly
throughout this pass with real requests, not left unchecked: webhook HMAC
signature verification (correct signature passes, wrong one 401s),
admin-only route enforcement (403 for non-admins, verified for every
admin endpoint added), rate limiting (both the bucket-isolation bug above
and the basic reject-after-N-requests behavior), and ban enforcement —
see the Rate limiting, Moderation queue, and Reports/bans/appeals
sections above for each. A proper DAST pass against a JSON API would use
ZAP's *active* scan against individual endpoints (or a tool built for
API testing specifically), not the baseline spider — a real follow-up,
not something to fake here.

## What's still a stub

- **Chat**: not wired to Centrifugo at all — see the Rate limiting section
  above. Local-only fake messages in the UI, no backend involvement.
- **SMS**: OTP codes are logged to the console in dev
  (`apps/api/src/auth/sms-gateway.ts`), behind the same kind of interface
  pattern as Chapa.
- **Avatar art**: avatar parts are flat color swatches, not illustrated
  character art — see `packages/shared/src/avatarRender.ts`.

## Known dependency vulnerability (unresolved, flagged not silently patched)

`npm audit` (surfaced while adding `apps/e2e`'s dependencies) reports a
high-severity `sharp <0.35.0` / libvips CVE, pulled in transitively by
`next@16.2.11` (used for `next/image`'s optional image-optimization API
route). `npm audit fix --force` "fixes" it by downgrading to
`next@14.2.35` — undoing this project's own earlier deliberate Next 14→16
upgrade (done specifically for unrelated CVEs), so that's not something
to run silently. No stable Next 16.x release newer than 16.2.11 exists
yet as of this writing (only 16.3.0 canary/preview builds) with a fixed
`sharp`. Actual exposure is low — `grep -rl "next/image"` across
`apps/web` returns nothing, the app only ever uses plain `<img>` tags
(see the `eslint-disable-next-line @next/next/no-img-element` comments in
`StreamCard`/`CreatorCard`/etc.), so the vulnerable code path is never
actually invoked — but it's still an installed dependency, worth tracking
until a real fix ships upstream, not silently ignored or falsely marked
resolved.
