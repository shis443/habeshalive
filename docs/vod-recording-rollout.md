# VOD recording + publish workflow rollout

## What's real and verified, not just written

Everything below was checked against a real Postgres, a real Redis, and
the real compiled API server — not just typechecked:

- **Migration `0028_vod_publish_workflow.sql`** (`is_published`, `title`,
  `description`, `category`, `views` on `stream_vods`): applied cleanly
  against a fresh throwaway Postgres running the *entire* real migration
  chain (all 28 files), not just this one in isolation.
- **Service layer** (`apps/api/src/vods/service.ts`,
  `apps/api/src/follows/service.ts`'s new `getCreatorProfile`): 16 new
  real, DB-backed tests (`vods/service.test.ts`, `follows/service.test.ts`)
  — published-vs-draft filtering, per-VOD title/category override
  fallback, and specifically the ownership checks (publish/unpublish/
  delete all reject a non-owner with a 404, verified to also leave the
  target row completely untouched, not just reject the call). Full suite:
  63/63 passing, no regressions.
- **The real HTTP layer, not just service functions**: ran the actual
  compiled API server against the test Postgres/Redis, minted a real JWT
  matching the app's own signing convention, and drove the whole flow over
  real HTTP — `GET /vods/mine` (draft + published both visible to the
  owner), `PATCH /vods/:id/publish` (with a live title/category override,
  confirmed it landed), `POST /vods/:id/view` (confirmed the counter
  actually incremented on a re-fetch), `DELETE /vods/:id` (confirmed the
  row was actually gone after), and both the ownership-rejection (wrong
  JWT → 404) and no-auth (→ 401) cases.
- **The new profile page** (`/watch/[username]`'s tabbed offline view):
  seeded a real creator with a real published VOD and a real draft via
  direct SQL, hit the real page through a real Next.js dev server pointed
  at the real API, and confirmed Home/About/Videos all render real data —
  including that the draft never leaked into the public Videos tab, and
  that view count + publish date render correctly (`42 views · 8/6/2026`).
- **SRS config** (`dvr{}` block, `on_dvr` hook, the internal-only `/dvr/`
  nginx location): `nginx -t` syntax check, then a full local dry-run — a
  real file served through the internal-only IPv6 listener, a miss
  cleanly 404ing, and confirmation the public listener (1986) still 403s
  `/dvr/` — all before touching production. See `srs.conf.template` and
  `whip-proxy.nginx.conf`'s own comments for the full reasoning.

## What's still blocked: real VOD_S3_* credentials

`apps/api/src/vods/service.ts`'s `createVodFromRecording` — which fetches
the recording from SRS and uploads it to object storage — has been real,
tested code since before this pass (it just had nothing feeding it). It's
still blocked on the one thing nobody but you can provide: real R2/S3
credentials. `apps/api/src/common/object-storage.ts` is fully implemented
and ready; `VOD_S3_ENDPOINT`/`VOD_S3_ACCESS_KEY_ID`/
`VOD_S3_SECRET_ACCESS_KEY` are all empty by default (`VOD_S3_BUCKET`
defaults to `habeshalive-vods`, override only if you want a different
bucket name).

Once you have a real Cloudflare R2 (or any S3-compatible) bucket, set the
real secrets yourself, directly — not pasted here:

```
flyctl secrets set VOD_S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com" -a habeshalive
flyctl secrets set VOD_S3_ACCESS_KEY_ID="<real-access-key>" -a habeshalive
flyctl secrets set VOD_S3_SECRET_ACCESS_KEY="<real-secret-key>" -a habeshalive
```

## Deploying the SRS config change

`infra/srs/conf/srs.conf.template` and `infra/srs/conf/whip-proxy.nginx.conf`
both changed (dvr{}, on_dvr, the internal /dvr/ location) — this needs a
`habeshalive-srs` redeploy, same care as every other SRS config change
this project has made: confirm `/streams/live` is empty before restarting
(no live stream gets interrupted), deploy, confirm the machine comes up
healthy. Do this independently of the VOD_S3_* credentials above — the
dvr{} recording + on_dvr webhook firing works regardless; without real
credentials, `/webhooks/vod-ready` will receive the callback and then fail
inside `createVodFromRecording`'s `uploadObject` call (a clean, logged
500, not a crash — SRS doesn't retry on_dvr on a non-2xx response, so a
recording made before credentials are set is just never turned into a
VOD, not lost in some half-state).

**Recommended order**: set the real credentials first, then deploy the
SRS config change — that way the very first real recording made after
deploy succeeds end-to-end, rather than needing a second stream to
actually exercise the fixed path.

## Known gap, flagged rather than fixed: local recording accumulation

SRS's `dvr{}` block writes each recording to local disk
(`./objs/dvr/...`) before the `on_dvr` webhook fires and apps/api uploads
it to R2. Nothing currently deletes that local copy afterward — `apps/api`
and `habeshalive-srs` are separate Fly machines with no shared filesystem
and no remote-delete mechanism wired up (the internal-only nginx location
serving `/dvr/` is read-only; adding a DELETE-capable endpoint there was
out of scope for this pass). This is **not** the same class of bug as the
public-exposure issue this design otherwise avoids (see
`srs.conf.template`'s own comment) — local recordings are private,
reachable only over Fly's internal network — but they will accumulate on
`habeshalive-srs`'s ephemeral disk over time on a machine that stays up
for a long time (`fly.toml` sets `min_machines_running = 1`,
`auto_stop_machines = false`). Worth a follow-up: either a small
authenticated internal DELETE endpoint apps/api can call right after a
successful upload, or a scheduled cleanup job on the SRS side. Flagging
this now rather than leaving it to be discovered as "why is this disk
full" later.

## Scope notes on the profile page

- Extended `/watch/[username]` in place (its existing offline path) rather
  than building a second, competing `/[username]` route — see this
  feature's own scoping discussion. The **live** view (video + chat) is
  completely unchanged; the new header/tabs only apply to the offline
  path, where there's no video filling the screen to make room for them.
- Three tabs (Home/About/Videos), not six — Clips has zero backing system
  in this codebase at all (shown as an explicitly-marked placeholder
  section within Home, not a full tab), Schedule has no backend concept
  anywhere in the repo (omitted rather than adding a second undiscussed
  placeholder beyond what was explicitly scoped), and Chat is already
  always visible inline while a stream is live, with no offline-chat
  concept to put behind a tab.
- `FeaturedClipsPlaceholder.tsx`/`RecentCategoriesPlaceholder.tsx` are
  deliberately styled distinct from real content (dashed borders, a
  "coming soon" label) — real viewers should never be able to mistake
  these for actual data, even though they're an intentional, agreed-on
  placeholder rather than something to silently omit.
- The offline header (`ChannelHeader.tsx`) only shows a real, fully-
  functional Follow button — not Gursha/Gift-a-Sub/Subscribe, which
  either need live-chat coupling (Gursha) or `tiers` data not fetched on
  this path. Shipping buttons that look clickable but don't do anything
  would be worse than the smaller action set shown.
