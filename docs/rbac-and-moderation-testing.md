# RBAC and moderation manual testing checklist

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
