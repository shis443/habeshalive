# Security

This describes the actual security posture of the deployed stack — Fastify
(`apps/api`) + Neon (managed Postgres) + Redis + Centrifugo + self-hosted SRS
+ Fly.io (API/SRS/Centrifugo) + Vercel (`apps/web`). **There is no Supabase or
Firebase anywhere in this project** — no such dependency, import, or env var
exists in the codebase (confirmed by repo-wide search before writing this
doc). If you're looking for row-level-security policies, they don't apply
here: authorization lives entirely in API middleware and query-level
`WHERE` clauses, not in the database layer.

This document was written from a direct audit of the running code
(2026-08-02), not from memory or an earlier plan — every claim below has a
file:line behind it in the commit history around that date. Where something
is a known gap rather than a solved problem, it's labeled as such, not
glossed over.

## Authentication

- Two independent OTP channels (phone via SMS gateway — **currently a
  console-log stub, no real Ethiopian SMS gateway wired up**; email via
  Resend, real when `RESEND_API_KEY` is set) plus password login for
  returning users, plus Google/Apple social sign-in
  (`apps/api/src/auth/social-service.ts`, ID-token verification via `jose`
  against each provider's real JWKS endpoint — real when
  `GOOGLE_CLIENT_ID`/`APPLE_CLIENT_ID` are set, `501` otherwise).
- Passwords: scrypt salt:hash (`apps/api/src/auth/password.ts`), not
  bcrypt/argon2 — an existing, already-proven pattern in this codebase
  (also used for OTP codes), not a new dependency.
- Session tokens are JWTs (`JWT_SECRET`), embedded with `role` at sign time
  — **a role change doesn't take effect until the user's next login/token
  refresh** (`apps/api/src/app.ts`'s `requireAdmin` comment).
- Multi-account sessions: the web app's session cookie holds up to 5
  accounts (`{activeUserId, accounts: [{userId, username, token}]}`,
  `apps/web/lib/session.ts`), never a token in localStorage/sessionStorage
  — deliberately, to keep tokens out of anything JS-readable/XSS-exposed.
- Login rate limiting: 5 attempts per identifier per 15 minutes,
  IP-independent (see Rate limiting below).

## Authorization

**There is no role-based-permission system beyond a single flat `role`
column.** `db/schema.sql`'s `users.role` is a 4-value CHECK
(`viewer`/`creator`/`moderator`/`admin`); `app.requireAdmin`
(`apps/api/src/app.ts`) is a single `req.user.role !== "admin"` check. An
earlier plan called for a richer 7-role permission system
(`staff_roles`/`ROLE_PERMISSIONS`/`requirePermission`) — **this was never
started.** Zero trace of it exists in code, migrations, or docs. Every admin
is equally privileged; there is no way today to grant someone (e.g. a
support agent) access to only part of the admin panel.

What **is** solid: every admin API route is gated by `requireAdmin`
(confirmed for all ~49 routes across `admin/routes.ts`,
`moderation/routes.ts`, `wallet/routes.ts`), and `apps/web/app/admin/layout.tsx`
does a server-side redirect before the admin page shell renders for a
non-admin — not a client-side check that leaks page structure before an API
call fails.

## Stream ingest security

**Fixed 2026-08-02** (was a real, live vulnerability): the RTMP "stream
name" used to be the raw publish secret (`stream_key`) itself, which SRS's
HLS output mirrors directly into the public playback path — meaning every
viewer's `playbackUrl` contained the literal credential needed to hijack
that creator's publish stream, retrievable from an unauthenticated
`GET /streams/live`. Fixed by decoupling the two: the RTMP/WHIP "stream
name" is now the creator's own `userId` (already public everywhere else),
and the real secret travels only as a `?key=` query param SRS forwards to
`on_publish`/`on_unpublish` as `param`, validated server-side
(`markLiveByProviderStreamId`/`markEndedByProviderStreamId` in
`apps/api/src/streams/service.ts`) before authorizing a publish.

- **Key entropy**: `crypto.randomBytes(16).toString("hex")` — 128 bits.
- **Storage**: plaintext in `creator_profiles.stream_key`, not hashed —
  acceptable since it's a bearer credential compared server-side, same
  class as a session token, not a password.
- **Rotation**: `POST /streams/key/rotate`, user-initiated. No automatic
  rotation on suspicion of compromise.
- **Suspension/ban enforcement at publish time**: `markLiveByProviderStreamId`
  now checks `is_suspended`/`is_banned` before accepting a publish (this
  was also a real gap — previously only the browser go-live path checked
  status, not the raw-RTMP path, meaning a suspended creator could keep
  publishing over RTMP with a previously-issued key).
- **Known open gap**: no mechanism kills an *already-connected* RTMP
  session when a creator is banned mid-stream — enforcement is at
  publish-time only. Closing this needs SRS's own HTTP admin API
  (`:1985`), not yet integrated. A banned creator's existing broadcast
  keeps running until the 12-hour reaper backstop or they disconnect.

## Real-time (Centrifugo) security

- Connection tokens (`POST /chat/token`) are HS256 JWTs signed with
  `CENTRIFUGO_TOKEN_HMAC_SECRET` — a different secret from the API's own
  `JWT_SECRET`. Issued to anonymous viewers too, deliberately: a token only
  grants permission to open a socket and *subscribe*, not to publish.
- `stream-chat`/`gift-alerts`/`notifications` namespaces all have
  `allow_subscribe_for_client: true`, but **no namespace has
  `allow_publish_for_client` set** (confirmed in
  `infra/centrifugo/config.json`) — clients can never publish directly to
  Centrifugo regardless of which channel they subscribe to. All real
  message delivery goes through the API (`POST /chat/:streamId/messages`
  → moderation/rate-limit checks → Centrifugo's admin-key-authenticated
  publish), so **the fact that any client can subscribe to any stream's
  chat/gift-alert channel by knowing the (already-public) stream UUID is
  not a vulnerability** — chat and gift alerts are meant to be publicly
  visible to any viewer, the same as the stream itself.
- `notifications:<userId>#<userId>` uses Centrifugo's built-in per-user
  channel restriction (`allow_user_limited_channels`) — this one
  genuinely does need to be private, and is.
- **Real-time ban enforcement, fixed 2026-08-02**: `banUser`
  (`apps/api/src/moderation/actions-service.ts`) now calls Centrifugo's
  admin `disconnect` API to immediately drop the target's live
  connections, instead of only flipping a DB flag that an already-open
  WebSocket wouldn't notice until its token naturally expired (up to an
  hour).
- **Known open item, not yet done**: `CENTRIFUGO_API_KEY` and
  `CENTRIFUGO_TOKEN_HMAC_SECRET` default to the literal string
  `"dev-only-change-me"` (`apps/api/src/common/env.ts`) rather than an
  empty string — unlike `CHAPA_SECRET_KEY`/`RESEND_API_KEY`, which fail
  *closed* (stub mode) if unset, these fail *open* if the real Fly
  secrets were never actually set. Whether production's actual values
  were ever rotated off this default hasn't been confirmed as part of
  this audit (rotating them requires a coordinated change across two Fly
  apps and would drop every live real-time connection at the moment of
  rotation — deliberately not done unilaterally, see ROADMAP.md).

## Webhook security

- **Chapa** (`apps/api/src/wallet/routes.ts`): HMAC-SHA256 over the raw
  request body, `timingSafeEqual` comparison, fails closed (501) if
  `CHAPA_WEBHOOK_SECRET` is unset rather than accepting unsigned payloads.
  Replay protection is idempotency-based (a webhook for an
  already-processed `tx_ref` is a no-op), not an explicit
  timestamp/nonce window — accepted as sufficient in practice, not yet
  hardened further.
- **SRS** (`on_publish`/`on_unpublish`/`on_dvr` webhooks): a static shared
  secret (`VIDEO_WEBHOOK_SECRET`), travels as a `?secret=` query param
  since SRS can't send custom headers. **Fixed 2026-08-02**: comparison
  switched to `timingSafeEqual` (was a plain `!==`).

## Rate limiting

Redis-backed (`@fastify/rate-limit` + `ioredis`), shared across API
instances. Global default: 2000 req/min per IP, fails open on a Redis
outage (`skipOnError: true`).

Per-route overrides, all fail *closed* on Redis outage where they guard
something sensitive: auth routes (OTP request/verify, login,
password reset — keyed by phone/email, not IP), `wallet/topups`,
`wallet/gifts`, `wallet/payouts`, `gift-cards` purchase, `streams/boost`,
`chat` messages, and — **added 2026-08-02** — `subscriptions POST /`,
which previously had no rate limit at all despite being a real-money
route (now 10/hour, user-keyed, matching the other wallet routes, and
also gated by `rejectIfBanned` like every other sensitive write).

**Known gaps, not yet addressed**: `ads/routes.ts` (`POST /leads`,
`POST /:impressionId/click`), `creator-applications`, `follows`,
`notifications`, and the social-auth endpoints
(`POST /social/:provider`, `/link`) all rely on the global 2000/min
default only.

## CORS

**Fixed 2026-08-02**: was `origin: true` (reflects any `Origin` header
back — effectively open to all origins). Now an explicit allowlist of just
`WEB_PUBLIC_URL`, the one legitimate browser origin this API is ever
loaded from.

## Secrets management

- No hardcoded secrets or committed `.env` files found in the repo (only
  `.env.example` is tracked; `git ls-files | grep -i env` confirms this).
- Stub-vs-real pattern used consistently for third-party integrations
  (Chapa, Resend, Google/Apple OAuth): an empty-string env default means
  the code runs in a safe stub mode rather than silently misbehaving.
  `CENTRIFUGO_API_KEY`/`CENTRIFUGO_TOKEN_HMAC_SECRET` are the one
  exception to this pattern (see Real-time security above).
- `docker-compose.yml`'s local-dev defaults (`dev-only-change-me` for
  several values, `POSTGRES_PASSWORD: habeshalive`) are dev-only and
  match `.env.example` — not production credentials.

## Ledger integrity

Every balance-mutating code path (topups, gifts, payouts, subscriptions,
boosts, ad revenue settlement, gift cards — purchase/redeem/cancel) goes
through the same two shared helpers, `insertEntry`/`applyBalanceDelta`
(`apps/api/src/common/ledger.ts`), inside a DB transaction. No direct,
bypassing write to `wallet_balances_cache` or `ledger_entries` was found
anywhere in the codebase outside of these helpers and the one-time
zero-balance wallet-creation inserts (which initialize, not delta, a
balance). `GET /admin/ledger/reconciliation` computes a real
sum(credits) == sum(debits) check across the whole ledger and surfaces it
in the admin UI.

## Content & input validation

- Every mutating route validates its body with a Zod schema
  (`packages/shared/src/schemas/`) before touching the database.
- Chat messages: server-side max length (500 chars, Zod), not just a
  frontend `maxlength` attribute. No server-side HTML sanitization exists,
  but this was checked and found not to be an issue in practice —
  `ChatPanel.tsx` renders message text as a plain JSX expression
  (`{entry.text}`), which React escapes by default. No
  `dangerouslySetInnerHTML` path renders user-supplied chat text anywhere.
- File "uploads" (avatars, stream thumbnails) are not real binary uploads
  — avatars are composed server-side from a fixed admin-curated part
  manifest (no user-supplied image bytes at all), and thumbnails are
  client-compressed base64 data URLs capped at 500,000 chars with no
  server-side magic-byte/content validation. Low risk in practice (no
  object storage serves these as executable content), but worth
  revisiting if/when real file uploads (e.g. VOD downloads, a real avatar
  upload flow) are added.

## Known accepted risks / deferred items

These are documented gaps, not oversights — each has a reason it wasn't
closed in this pass:

1. **RBAC** — flat admin role only, no granular permissions. Real work,
   not a quick fix; see ROADMAP.md.
2. **Active RTMP session isn't killed on ban** — publish-time enforcement
   only. Needs SRS admin API integration.
3. **Centrifugo secret rotation** — deliberately not done unilaterally;
   touches two Fly apps and would drop every live real-time connection at
   the moment of rotation.
4. **Egress/CDN protection** (bandwidth alerting, budget caps, hotlink
   protection, signed URLs) — an infrastructure/cost decision, not a
   code-only fix; needs its own scoping conversation.
5. **Webhook replay protection is idempotency-based, not timestamp-windowed**
   — accepted as sufficient for the current integration surface (Chapa
   only).
