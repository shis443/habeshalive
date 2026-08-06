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

## CORRECTED 2026-08-06: VOD_S3_* credentials are already set

Everything below this heading originally claimed the pipeline was
"blocked on real VOD_S3_* credentials," inferred from
`common/env.ts`'s comment ("no real bucket exists yet") without actually
checking. That was wrong, caught the same day while preparing a handoff
document: `flyctl secrets list -a habeshalive` shows
`VOD_S3_ACCESS_KEY_ID`, `VOD_S3_BUCKET`, `VOD_S3_ENDPOINT`,
`VOD_S3_SECRET_ACCESS_KEY` all **already deployed** (present since at
least 2026-08-05, per that day's own handoff doc — this pass's docs
just never checked). `apps/api/src/common/object-storage.ts`'s
`isObjectStorageConfigured` is real, not a stub — it means the object
storage upload path should already be live, not dormant.

**What this changes**: the recording pipeline is very likely already
capable of working end-to-end right now, not blocked as previously
documented. **What's still genuinely unverified**: nobody has actually
triggered a real `on_dvr` callback against production yet (needs a real
OBS/ffmpeg stream against the now-deployed `dvr{}` config) to confirm the
whole chain — SRS recording -> on_dvr webhook -> fetch over the internal
`/dvr/` bridge -> real R2 upload -> `stream_vods` row -> visible in the
creator's dashboard prompt — actually works with these specific real
credentials. That's a real live-stream test, deliberately deferred (see
the bottom of this file).

## Deploying the SRS config change

**Done, 2026-08-06**: `infra/srs/conf/srs.conf.template` and
`infra/srs/conf/whip-proxy.nginx.conf` (dvr{}, on_dvr, the internal
/dvr/ location) deployed to `habeshalive-srs` — confirmed no live
stream was interrupted (`/streams/live` was empty first), machine came
up healthy, no crash-loop, public paths still correctly 403 `/dvr/` and
`/api/v1/`. Since VOD_S3_* credentials were already set (see above), the
very next real recording should exercise the fixed path end-to-end —
this just hasn't happened yet (needs a real stream).

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

## Deferred verification, marked for the next handoff document

Explicitly deferred on 2026-08-06, not forgotten — both need real
resources this environment doesn't have on its own (a live stream, or a
decision to mutate real production user data), and were deliberately
left for a session with more context/time rather than rushed or skipped
silently:

1. **Live-stream viewing with the DVR scrubber** (`VideoPlayer.tsx`,
   `hls_window` 10s->120s) against a real broadcast in production — no
   stream was live during this session's deploy window to test against.
   Verified structurally (typecheck, a local dev-server render), not
   against real production HLS.
2. **Authenticated write paths against production specifically**
   (`PATCH /vods/:id/publish`, `.../unpublish`, `DELETE /vods/:id`,
   `POST /avatars/save`) — exhaustively verified against a local
   throwaway Postgres with a real HTTP round-trip and a real minted JWT
   (ownership rejection, 401/404 cases, all covered), and the exact same
   code + migration is what's live now, but not re-run against
   production itself specifically — that means either a real user
   session or minting test data in the real database, both more
   consequential than the read-only checks already done.
