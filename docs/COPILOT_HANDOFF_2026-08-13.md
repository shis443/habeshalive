# Copilot handoff — Flutter-reference rebuild

**Date:** 2026-08-13  
**Repository:** `/Users/adem/Downloads/stitch_ethiostream/habeshalive`  
**Current commit:** `5a6f4724a748720eeaa3b78709bf22af9d518eb6` — `Flutter reference literal rebuild: Browse + real category catalog`  
**Git state:** `main` and `origin/main` both point to `5a6f472`. The work is committed and pushed.

This handoff document is a new, uncommitted local file. Commit it with the
next scoped implementation phase, or in its own documentation-only commit;
do not include unrelated uncommitted files in that commit.

## Absolute deployment rule

**Do not deploy anything. Do not apply migration `0046`. Do not retrieve,
print, copy, or inspect `DATABASE_URL` through `fly ssh`, Fly console, shell
history, logs, or another workaround.**

The production API and database are intentionally unchanged. The user will
later apply the migration and deploy API/web together through their own
production credential/CI workflow. Until the user explicitly says that the
release is authorized, work locally and commit normally only.

The reason for holding the release is consistency: Browse now relies on the
new `/categories` API. Deploying web first would make its Categories tab empty
against the current production API, and applying the schema/API without the
coordinated web release is not yet desired.

## Product direction — do not reinterpret

The cloned `fluttership/Twitch-Clone-Flutter` repository is the **literal
visual and interaction specification for all consumer-facing UI above the
bottom navigation**. This supersedes older “loose Twitch-inspired” work.

The only protected UI is Birq's existing glass bottom navigation:

- Native iOS: five tabs — Explore, Following, Go Live, Wallet, Profile.
- Web: glass bar — Explore, Following, Go Live, Wallet.
- Preserve safe-area behavior and the native WKWebView suppression that
  prevents a duplicate web nav in the native app.

Do not copy Flutter/Dart code, Twitch branding, remote images, demo users,
or reference fonts. Recreate the Flutter layout and density using Birq's real
typed data and Birq-owned/generated visual assets.

## Read these first

1. `docs/FLUTTER_UI_REBUILD_AUDIT.md` — exact dimensions and layout behavior
   extracted from the Flutter source.
2. `docs/FLUTTER_UI_REBUILD_PLAN.md` — approved phase order and constraints.
3. `docs/TWITCH_UI_IMPLEMENTATION_PLAN.md` and
   `docs/TWITCH_REFERENCE_FEATURE_AUDIT.md` — historical only; superseded
   where they conflict with the two documents above.
4. Flutter reference checkout, if still available:
   `/private/tmp/fluttership-twitch-clone/`.

## Completed locally — committed, but not deployed

### 1. Real category catalog (full local vertical slice)

Migration: `db/migrations/0046_content_categories.sql`

- Adds `content_categories` and `category_tags`.
- Seeds the four existing category values: `Music`, `Gaming`, `Traditional`,
  and `Just Chatting`.
- The category `slug` intentionally matches existing `streams.category` and
  `category_follows.category` string values. It does **not** add risky foreign
  keys to those established columns.
- Catalog rows contain real name, description, nullable `artwork_url`, sort
  order, active status, and curated tags.
- `artwork_url = NULL` deliberately uses Birq's deterministic generated-art
  fallback. Do not introduce third-party image URLs.

Shared contract: `packages/shared/src/schemas/categories.ts`

- `ContentCategory` includes typed catalog data plus server-computed
  `liveViewerCount`, `liveChannelCount`, and `followerCount`.
- Admin create/update schemas are defined here.

API:

- Public: `GET /categories`, `GET /categories/:slug` in
  `apps/api/src/categories/routes.ts`.
- Service: `apps/api/src/categories/service.ts`.
- Admin API, protected by existing `requireAdmin`:
  `GET /admin/categories`, `POST /admin/categories`,
  `PATCH /admin/categories/:slug` in `apps/api/src/admin/routes.ts`.
- A visual admin management page has **not** been built. Do not claim one
  exists; the API surface is present for a later dedicated admin UI.

Data behavior:

- Aggregates are computed from real current rows on every request:
  `streams.status = 'live'`, `streams.peak_viewers`, and `category_follows`.
- No static/fake viewer or follower counts exist in this slice.
- `apps/api/src/categories/service.test.ts` checks seeded category data and
  live-stream aggregate behavior against the test database.

Web helpers:

- `apps/web/lib/api.ts`: `getCategories()` and `getCategoryBySlug()`.
- `getCategories()` returns an empty list for an HTTP non-success response;
  it does not fabricate category cards. Note that a thrown network exception
  is not currently caught there — keep that distinction in mind if adding a
  user-facing error boundary/state.

### 2. Shared Flutter-reference UI primitives

Created under `apps/web/components/reference/`:

- `SectionLabel`
- `UnderlineTabs` — URL-driven tabs; underline sized to the label text,
  matching Flutter `TabBarIndicatorSize.label`
- `MetadataChip`
- `MediaStatusOverlay`
- `LiveCardLarge` — real HLS hover preview retained via `StreamCardPreview`
- `CategoryRowCompact` — the correct 50×80 compact Browse category row

New type tokens are in `apps/web/app/globals.css`:

- `--ref-title`
- `--ref-section-label`
- `--ref-body-lg`
- `--ref-body`
- `--ref-caption`
- `--ref-badge`

### 3. Browse page rebuild

Changed:

- `apps/web/app/browse/page.tsx`
- `apps/web/app/browse/page.module.css`
- `apps/web/components/LiveChannelsGrid.tsx`
- `apps/web/components/LiveChannelsGrid.module.css`

The Flutter reference is followed here:

- 40px-style `Browse` title.
- Underline tabs in exact reference order: **Categories**, then **Live
  Channels**.
- Categories render `CategoryRowCompact`, not the earlier giant 3:4 gradient
  “M” cards.
- Live Channels render `LiveCardLarge`, not the old generic grid cards.
- `LiveChannelsSidebar` was intentionally removed from Browse because it
  conflicts with the reference's own Live Channels tab.
- Existing language/tag/sort filters, URL query state, deep links, and
  15-second live refresh remain intact.

## Deployment-dependent current behavior

Because migration `0046` and the API are not deployed, production does not
yet have the category catalog endpoint/tables. A production visit to Browse's
Categories tab will therefore not show real catalog rows until the coordinated
release occurs. This is expected and must not be “fixed” with static fallback
content.

Do not deploy a partial frontend-only workaround. Continue the remaining
work against the typed category contract locally.

## Remaining implementation — exact order

### Phase B — Following (next)

Replace the current creator grid in `apps/web/app/following/` with the
Flutter reference layout:

1. `LIVE CHANNELS` using a new `LiveRowCompact` component.
   - Fixed 120×70 thumbnail.
   - Real live dot and viewer count.
   - Real creator avatar/name, stream title, category, and tags.
   - Link to the real `/watch/[username]` page.
2. `OFFLINE CHANNELS` using a new `FollowingOfflineRow`.
   - 40×40 avatar, creator name, real unseen-content count, trailing dot
     only if that count is positive.
   - Extend the existing `GET /follows/mine` slice from boolean
     `hasNewContent` to a real count of new published VODs/clips since
     `following_last_seen_at`.
   - Required change chain: shared follow schema → follows service query →
     route/API helper → UI → unit/e2e tests.
   - Do not display a made-up count and do not replace the count with a
     boolean labelled as a number.

### Phase C — Discover

Rebuild `apps/web/app/discover/`:

- Flutter-style large `Discover` title.
- `LiveCardMedium`: fixed 370px-like, peeking horizontal manual rail.
- `CategoryRailCard`: 130×185 generated/owned category visual, real catalog
  name, aggregate viewer count, and tags.
- Use only real ranking signals already available: Birq rank, boost status,
  viewer count, activity, and recency.
- Do not add auto-play to rails or a fake “recommended” list.

### Phase D — Category detail

Rebuild `apps/web/app/category/[slug]/` using the new catalog:

- Add `CategoryHero`: 100×140 art, name, live-viewer/follower stat row,
  description/tags, and the existing functional category follow control.
- Replace rounded tabs with `UnderlineTabs`: Live Channels / Videos / Clips.
- Use `LiveCardLarge`, `VodCardReference`, and `ClipFeedCard` respectively.
- Preserve all real per-category streams, VODs, clips, follow state, loading,
  empty, error, and URL-addressable tab states.

### Phase E — Watch/channel refinement

Apply the reference hierarchy to `apps/web/app/watch/[username]/` without
altering live HLS playback, Centrifugo chat, PPV, follow authorization,
moderation, or creator controls. Reuse the reference type scale and metadata
primitives rather than creating a competing card system.

## Explicitly out of scope unless separately authorized

- Chromecast/AirPlay/cast control — no supported transport integration.
- Direct messages/inbox — requires threads, messages, blocking, real-time
  delivery, notifications, API, database, and tests.
- Clip favorite/save — requires persisted ownership-aware state.
- A category-admin visual UI — the protected API exists, but no screen yet.

Do not add visual placeholders for any of these. Hide an unsupported control
or implement its full vertical slice only after separate scope approval.

## Verification required after every phase

Run the relevant tests; do not merely state that they should pass:

```bash
npm run typecheck --workspace=apps/web
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api -- src/categories/service.test.ts
git diff --check
```

Also update/run the affected Playwright flow in `apps/e2e/`, and manually
inspect the page at **390×844** and **1440px**. Verify every interactive
control either changes real state or goes to a real destination.

The category service test requires a database with migration `0046` applied;
use the approved local/test database only, never production credentials.

## Later release runbook — for the owner only, not for Copilot to execute

When the user authorizes a production release, do it as one controlled
operation through existing secret-managed CI/deployment configuration:

1. Back up/confirm production database state using the existing operational
   process.
2. Apply `db/migrations/0046_content_categories.sql` with the deployment
   environment's existing secret injection; do not expose `DATABASE_URL`.
3. Deploy the API containing `GET /categories`.
4. Health-check `GET /categories` and one `GET /categories/Music` response.
5. Deploy the web app.
6. Check Browse → Categories, Browse → Live Channels, category routing,
   follow state, and API error monitoring.
7. Have a rollback plan before starting: web can roll back independently;
   the migration is additive and should generally remain, while the API/web
   return to the known-good release if necessary.

## Separate iOS crash track — do not conflate with web rebuild

Canonical iOS checkout:

`/Users/adem/Downloads/moblin-main`

The supplied crash report is a genuine native UIKit touch crash:

```text
UIGestureRecognizer _delayTouchesForEvent:inPhase:
-[__NSArrayM insertObject:atIndex:]: object cannot be nil
```

Relevant current source is in:

- `Birq/View/BirqExplore/BirqWebViewHolder.swift`
- `Birq/View/BirqExplore/BirqExploreView.swift`
- `Birq/View/RootTabView.swift`

`BirqWebViewHolder.swift` already contains
`webView.scrollView.delaysContentTouches = false`, committed in `9a80b03`.
The unresolved question is whether the crashing Simulator app was freshly
built from that source or was a stale installation.

Before any more native code changes:

1. Uninstall the old simulator app.
2. Build/install current native HEAD.
3. Set an Objective-C exception breakpoint.
4. Test first touch, scrolling, tab switches, search/notification actions,
   and returning to a web-backed tab.
5. If it still crashes, capture the exception-breakpoint stack before UIKit
   aborts; do not guess at another gesture workaround.

The iOS checkout has unrelated local changes in
`Birq/Media/HaishinKit/Codec/Video/VideoEncoder.swift` plus untracked local
logs/workspace files. Preserve them.

## Current uncommitted files in this web repository

Do not delete or fold these into the UI rebuild without the owner's explicit
instruction:

- `docs/COPILOT_HANDOFF_2026-08-13.md` — this handoff document
- `apps/web/next-env.d.ts`
- `verify_video.mjs`
- `verify_watch_video2.mjs`
- `verify_watch_video3.mjs`

## Suggested starting instruction for Copilot

> Read `docs/COPILOT_HANDOFF_2026-08-13.md`, then
> `docs/FLUTTER_UI_REBUILD_AUDIT.md` and
> `docs/FLUTTER_UI_REBUILD_PLAN.md`. Do not deploy, migrate production, or
> access production secrets. Preserve unrelated uncommitted files. Continue
> Phase B (Following) completely: implement real compact live/offline rows,
> add a truthful unseen VOD/clip count through shared schema → API service →
> typed helper → UI → tests, verify at mobile/desktop, and commit only that
> phase. Keep the existing glass bottom navigation unchanged.
