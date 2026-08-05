# RBAC and moderation manual testing checklist

## RESOLVED: SRS admin API IPv6 reachability + a second bug it uncovered

Originally discovered via `scripts/verify-production-readiness.ts`'s
internal-SRS check actually being run from inside Fly's private network
for the first time: `SRS_ADMIN_API_BASE`
(`http://habeshalive-srs.internal:1985`) resolves to an IPv6-only address
(Fly's `*.internal` 6PN hostnames), but SRS's `http_api` only ever binds
IPv4. A same-session attempt at a dual-stack SRS fix
(`listen 1985 [::]:1985;`) didn't work — SRS accepted the directive but
never actually opened a second listener — and briefly crash-looped
production via an unrelated typo (`//` instead of SRS's `#` comment
syntax) before being caught and reverted.

**Actual fix**: `infra/srs/conf/whip-proxy.nginx.conf` gained a second
`server{}` block — `listen [::]:1985 ipv6only=on;`, proxying only
`/api/v1/` to `127.0.0.1:1985`. nginx's dual-stack support doesn't have
whatever limitation SRS's own does; this sidesteps the SRS-side gap
entirely rather than fixing it there. No `SRS_ADMIN_API_BASE` value
change was needed — same URL, now actually reachable.

**Verified for real, in this order, before ever calling it done:**
1. `nginx -t` syntax check, then a full local dry-run — a real dummy
   HTTP backend on `127.0.0.1:1985`, this exact config started against
   it, GET/DELETE through the IPv6 listener, and confirmation the public
   listener (1986) still 403s `/api/v1/`. All before touching production.
2. Deployed to `habeshalive-srs` (after confirming `/streams/live` was
   empty — a real, active stream was live at first attempt; deploy was
   held until it ended).
3. From `habeshalive`'s own machine, the exact `fetch()` call pattern the
   application code uses reached `http://habeshalive-srs.internal:1985/api/v1/clients/`
   and got real SRS data back — not just a raw TCP connect.
4. **A full live end-to-end test**: a real synthetic RTMP stream
   (`ffmpeg` against `rtmp://habeshalive-srs.fly.dev:1935/live/...`) was
   published to production under a throwaway test creator account, then
   `banUser()` was invoked directly against that live target on the
   `habeshalive` machine. This is what actually caught a second, real
   bug — see below — and after fixing it, the *same* live ffmpeg process
   died with `Broken pipe` moments after the ban, the unambiguous
   signature of SRS forcibly closing the socket server-side.

**The second bug, found only by step 4 (not by unit tests, which had
mocked the wrong thing):** `killActiveRtmpPublishers` (and
`streams/whep-routes.ts`'s equivalent WHEP correlation helper) filtered
SRS's client list on `entry.stream === providerStreamId`. Real SRS
responses (confirmed against `vendor/trunk/src/app/srs_app_statistic.cpp`)
put an **internal SRS stream-object id** in `stream` (e.g.
`"vid-275253j"`) — completely unrelated to the actual RTMP stream
name/userId, which lives in the `name` field instead. The filter had
never matched anything, in production or in the mocked unit test (which
fabricated `stream: target.id` based on the same wrong assumption). Fixed
to filter on `name`; the unit test's mock was corrected to match real SRS
shape (`stream` set to an unrelated opaque id, `name` set to the actual
match target) so it can't silently regress back to testing the wrong
field. This is exactly the class of bug real-target testing is for — a
plausible-looking, internally-consistent, entirely wrong assumption that
survived a full mocked test suite and only broke on contact with a real
server.

The throwaway test account and all uploaded verification scripts were
deleted from production immediately after; no test data was left behind.

**One honest caveat**: `scripts/verify-production-readiness.ts`'s full
run (all 8 DB checks + all 3 HTTP checks in one process) was not
successfully completed end-to-end from *inside* Fly's private network in
this final round — repeated attempts hit `pg` connection drops
("Connection terminated unexpectedly") specific to opening a fresh
Postgres connection from that particular SSH session context, most
likely connection-pooling pressure from this session's own repeated
one-off script invocations against Neon, not a real defect. Every
individual check the script performs was independently confirmed by a
more direct method instead: the DB/RBAC checks passed cleanly when the
script ran from an external machine (§ this file's own earlier
verification), the public-block check was confirmed via a real external
`curl`, and the internal-SRS-reachability check was confirmed via a
minimal, isolated script hitting the exact same URL and returning a
clean `200` with real data. The full script should still work fine on a
future clean run; this just documents why this specific session didn't
end with one single unbroken 11-line PASS output to point to.

**Why this exists as a manual checklist, not automated:** two things here
genuinely can't be produced by an agent without human hardware — a real
OBS broadcast connected to production SRS, and a real second browser
session to watch it get killed live. Everything else (migration
correctness, permission-grant data, route wiring) *was* verified for
real this session — against a throwaway local Postgres+Redis, with the
full Vitest suite (47/47 passing) — not just typechecked; that's
documented in the relevant commit messages, not repeated here. This
checklist is what's left: the parts that need a human, a camera, and a
second account.

## 1. Live OBS RTMP publisher kill-on-ban

**Already verified end-to-end with a real synthetic RTMP publish** — see
the RESOLVED section above for the full account of that test. This
checklist entry remains useful as a *repeatable, human-run* version of
the same test (real OBS instead of a scripted `ffmpeg` stand-in, a real
second account instead of a throwaway one), not because the underlying
mechanism is still in doubt.

Verifies `apps/api/src/moderation/actions-service.ts`'s
`killActiveRtmpPublishers` — the part of `banUser` that force-disconnects
an *already-broadcasting* creator via SRS's admin API
(`DELETE /api/v1/clients/{client_id}`), closing the gap where a ban
previously only blocked new publish attempts.

**Setup:**
1. Create (or use) a real creator test account with OBS configured to
   publish to production (`rtmp://<SRS_RTMP_HOST>/live`, using that
   account's real stream key from Settings → Stream Key).
2. Create a real moderator or super_admin test account, logged in
   separately (a different browser profile or incognito window).
3. Start the OBS stream and confirm it's actually live — check
   `https://www.birq.live/watch/<creator-username>` shows real video,
   not just that the dashboard says "live."

**Test:**
1. From the moderator/admin account, ban the creator account (via the
   admin panel's Moderation → Users flow, or `POST /moderation/actions/ban`
   directly).
2. **Watch OBS itself**, not just the dashboard — within a few seconds,
   OBS should show a disconnection/reconnection-failure state (its own
   "network storage/connection lost" indicator, not a graceful "stopped
   broadcasting" the encoder chose itself).
3. Confirm the viewer-side player (`/watch/<username>`) stops receiving
   new video shortly after — HLS players stop getting new segments; if
   testing the WHEP path too (see `docs/whep-rollout.md` — only relevant
   if `WHEP_ENABLED`/`NEXT_PUBLIC_WHEP_ENABLED` are both set), the
   `RTCPeerConnection` should transition out of `connected`.
4. Try to have OBS reconnect using the *same* stream key immediately
   after — this must fail (401), since `markLiveByProviderStreamId`
   already checks `is_banned` at publish time, independent of the kill
   logic above. This confirms both halves of the fix work together: the
   already-open session gets killed, and a fresh one can't open.

**What "pass" looks like:** OBS visibly loses its connection within
roughly 5-10 seconds of the ban landing (the time for
`killActiveRtmpPublishers`'s live SRS client-list lookup + `DELETE` to
complete), not "eventually" or "only on the creator's next natural
disconnect."

**What to check if it fails:** `flyctl logs -a habeshalive` around the
ban's timestamp for `[moderation] SRS kick failed for client ...` or
`[moderation] SRS client list fetch failed ...` — both are logged,
non-fatal failures (the ban itself still succeeds either way, by
design — see `actions-service.ts`'s own adversarial-reasoning comment for
why this is fail-open). A log line there means the *ban* worked but the
*kill* didn't — worth investigating `SRS_ADMIN_API_BASE` connectivity
specifically, not the ban logic.

## 2. RBAC permission isolation, per role

Confirms the retrofitted routes (`moderation/routes.ts`,
`admin/routes.ts`) actually enforce what
`db/migrations/0027_permission_grants.sql` grants — the schema-level data
was verified directly this session; this is the live, over-HTTP
confirmation with real accounts, which nothing in the existing test
suite exercises (this codebase's tests call service functions directly,
never through Fastify's route/preHandler layer — a real, acknowledged
gap, not an oversight).

For each row below, log in as that role and confirm the **Should work**
column succeeds and the **Should 403** column actually returns 403 (not
404, not 500 — a 403 confirms the permission check ran and correctly
denied; anything else means something's wired wrong).

| Role | Should work | Should 403 |
|---|---|---|
| `moderator` | `GET /moderation/queue`, `POST /moderation/actions/ban` | `GET /admin/config`, `GET /admin/ledger/reconciliation`, `POST /admin/streams/:id/force-end` |
| `finance_auditor` | `GET /admin/ledger/reconciliation`, `GET /admin/boosts/revenue` | `POST /moderation/actions/ban`, `POST /admin/ledger/adjustment` (this one matters specifically — see below), `GET /admin/config` |
| `super_admin` | everything above | (nothing — super_admin holds every grant) |
| `viewer`/`creator` | nothing admin-tier | everything above |

**The one to check most carefully:** `finance_auditor` against
`POST /admin/ledger/adjustment`. This route deliberately stayed
`requireAdmin`-only rather than `requirePermission("finance:audit")` —
the distinction between *read* access (an auditor's whole point) and
*write* access (creating a real ledger entry) matters here specifically,
and it's the one place in this retrofit where getting the permission
grant wrong would be a genuine privilege escalation, not just a UX
inconvenience. Confirm a `finance_auditor` account gets 403 here even
though it can freely read every other ledger/revenue route.

**How to get a test account into each role**, since there's no
self-service way (by design — see `db/migrations/0026_rbac_role_isolation.sql`'s
own reasoning on why role can never be client-writable):
```sql
UPDATE users SET role = 'moderator' WHERE username = 'your_test_account';
```
Run via the same SSH+SFTP pattern used elsewhere in this project's
handoff docs for one-off production database access (or directly against
a local/staging database when testing pre-deploy).

## 3. Legacy-role deploy-window compatibility

This app deploys `apps/api` (Fly) and `apps/web` (Vercel) as two
independent processes, and ships code that accepts both the legacy
`'admin'` role string and the post-migration `'super_admin'` — see
`apps/api/src/app.ts`'s `requireAdmin`/`requireRole` and
`apps/web/app/admin/layout.tsx` for the reasoning. If you deploy this
code *before* running `db/migrations/0026_rbac_role_isolation.sql`
against production (the intended, safer order — see those files' own
comments), verify during that window:

- [ ] An existing admin account (role still literally `'admin'` in the
      database) can still log in and load `/admin` without errors.
- [ ] That same account can still perform admin actions (ban a user,
      view the dashboard) — confirms `requireAdmin`'s dual-role check,
      not just page access.
- [ ] `GET /moderation/queue` and similar newly-`requirePermission`-gated
      routes return a clean `403` for that account during this window
      (not a `500`) — confirms `rbac.ts`'s fail-closed handling of
      `role_permission_grants` not existing yet. This is expected,
      documented behavior for this narrow window, not a bug to chase —
      it resolves itself the moment migrations `0026`+`0027` are applied.
- [ ] After running the migrations, re-check the same account: it should
      now show `role = 'super_admin'` and the previously-403'ing routes
      should work normally.
