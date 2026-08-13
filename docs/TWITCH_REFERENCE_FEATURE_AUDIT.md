# Twitch-Clone-Flutter reference audit

Reference: `fluttership/Twitch-Clone-Flutter`, checked out locally at
`/Users/adem/Downloads/Twitch-Clone-Flutter-master`. Read for UX/interaction
patterns only — see "What the reference actually is" below before treating
anything in it as a functional spec.

## What the reference actually is

Every screen in the Flutter app is backed by an in-memory `ChangeNotifier`
controller (`lib/controller/*.dart`) holding hardcoded Dart list literals —
there is no HTTP client anywhere in the codebase, no API, no persistence.
Almost every tap handler is empty (`onPressed: () {}` / `onTap: () {}`). The
global app bar's cast/notifications/comment/search icons, every live-stream
card's tap target, every video/clip card's tap target, and a clip's
favorite/overflow/"Watch full video"/"Share" buttons are all dead. The only
two working interactions in the entire app are the bottom-tab switcher and
category-card taps (which push a category detail route).

This matters for scope: Birq is not "missing functionality that Twitch-Clone
has." In most cases it is the reverse — Birq's equivalents already read and
write real, database-backed state where the reference has a static list and a
no-op. The gap this audit tracks is almost entirely **visual density and
information hierarchy**, plus a small number of genuinely new signals (a
featured-live rail layout, category header stats) that Birq's API already
has data for but doesn't yet surface.

## Screen-by-screen table

| Flutter screen/component | User-visible purpose | Current Birq equivalent | Existing route/API/DB source | Gap | Proposed real implementation | Migration required | Test coverage required |
|---|---|---|---|---|---|---|---|
| Global `AppBar` (cast/notifications/comment/search icons) | Quick actions from anywhere | `TopNav.tsx` (search, notification bell with unread count, auth menu) | `GET /notifications/unread-count`, `GET /search` | None — Birq's are already real; cast has no Birq transport (no Chromecast/AirPlay integration exists) and comment/DM has no product surface | Keep Birq's real bell + search. Do **not** add a cast icon — no functional target exists. Do not add a DM icon — no DM product surface exists | No | Already covered by existing TopNav tests |
| Bottom `BottomNavigationBar` (Following / Discover / Browse) | Primary navigation | `components/BottomNavClient.tsx` (Explore / Following / Go Live / Wallet) | Static route table | Different tab set by design — Birq's nav already maps to its real destinations (Explore *is* Birq's discovery surface incl. category pills; Discover is a secondary curated page linked from Browse) | **No change.** Explicitly preserved per product requirement | No | Existing nav render test |
| `following.dart` — LIVE CHANNELS section | See which followed creators are live now, with title/category/tags | `app/following/page.tsx` + `CreatorCard.tsx` | `GET /follows/mine` (`getFollowedCreators`), real `isLive` per creator | Visual density only — Flutter shows title + category + tag chips inline; Birq's card shows bio + one category tag | Extend `CreatorCard` to show live stream title (already in `CreatorSearchResult`? verify) and full tag list, matching `StreamCard`'s metadata row | No (uses existing follows data) | Update `CreatorCard` render test if one exists |
| `following.dart` — OFFLINE CHANNELS section, "N new videos" dot | Know when an offline creator posted something | Same page, `hasNewContent` boolean dot | `getFollowedCreators()` real per-creator flag (VOD/clip recency vs. last-seen), `POST /follows/mine/seen` via `FollowingSeenBeacon` | None functionally — Birq's version is *more* real than the reference (reference shows a raw hardcoded count; Birq's is a real recency comparison, deliberately not a fake number) | Keep as-is | No | Already exercised by follows tests |
| `following.dart` tap behavior | (in reference: dead) | `CreatorCard` links to `/watch/[username]` | n/a | None — Birq is already better | No change | No | n/a |
| `discover.dart` — "RECOMENDED LIVE CHANNELS" peeking carousel | Featured live, swipeable | `app/discover/page.tsx` "Featured live" section, plain CSS grid of `StreamCard` | `GET /streams/live`, filtered client-side to `isBoosted` (real `stream_boosts` signal) | Layout only: grid vs. horizontal rail. Underlying data is already real (boosted streams — a real product signal, not invented curation) | Build a horizontally-scrolling rail component (reuses `StreamCard`, CSS scroll-snap, no new data) for the boosted-live section | No | Playwright: discover page renders rail, scroll works, keyboard-navigable |
| `discover.dart` — "RECOMMENDED CATEGORIES" rail | Category discovery | **Missing** — Birq's Discover page has no category rail today (`/browse`'s Categories tab exists but Discover doesn't surface it) | `STREAM_CATEGORIES` (4 fixed categories), `getCategoryFollowStatus` for counts | Real gap: no category-discovery rail on `/discover` | Add a category rail to Discover using the same generated-visual category tiles as Browse (§ Category data below) | No | Playwright: category tile navigates to `/category/[slug]` |
| `discover.dart` category tap | Navigate to category detail | N/A yet (see above) | `/category/[slug]` already exists and is fully real | — | Wire the new rail's tap to existing route | No | Covered by new rail test |
| `discover.dart` live-card tap | (in reference: dead) | `StreamCard` already links to `/watch/[username]` | n/a | None — Birq is already better | No change | No | n/a |
| `browse.dart` — Categories / Live Channels tabs | Two ways to find content | `app/browse/page.tsx` — same two tabs, `?view=` query param | Categories tab → `/category/[slug]`; Live Channels tab → `GET /streams/live` with category/language/tag/sort filters | None functionally. Reference has **no filter UI at all**; Birq already has language/tag/sort filters the reference doesn't. Visual density only | Apply Phase-1 card/spacing polish (done) | No | Existing browse tests |
| `categories_tile_small/medium` | Category card: image, name, viewer count, tags | `app/browse/page.tsx` category tiles — plain text tile, no image/count | `STREAM_CATEGORIES` only (no per-category metadata table) | Real gap — no cover art, no live viewer count shown on the tile (though live viewer count *is* computable from already-fetched `GET /streams/live` data, just not surfaced here) | See "Category data" section below | Only if per-category admin-editable description/art is desired (deferred decision) | Playwright: tile shows live count |
| `categories.dart` — category header (image, name, viewer/follower counts, tags) | Category identity at a glance | `app/category/[slug]/page.tsx` — heading + follow button only | `GET /follows/category/:category/status` **already returns a real `followerCount`** (`category-service.ts:getCategoryFollowerCount`, `SELECT count(*) FROM category_follows`) — currently fetched but not rendered. Live viewer count is computable by summing `viewerCount` across the already-fetched `liveStreams` for that category | Real, cheap gap: follower count and live viewer count are already in hand server-side and just need to be rendered — **zero new backend work** | Add a stats row (`N viewers now` / `N followers`) to the category header from existing data | No | Playwright: stats row renders correct numbers against seeded follows |
| `categories.dart` header cast/favorite icons | (in reference: dead) | Real `CategoryFollowButton` already does real follow/unfollow | `POST /follows/category/:category` | None — Birq's follow button is already real; no cast target exists for a category page either | No cast icon added | No | Existing follow button test |
| `categories.dart` — Live/Videos/Clips tabs | Category-scoped content | `app/category/[slug]/page.tsx` — same 3 tabs, real per-tab fetch | `GET /streams/live?category=`, `GET /vods?category=`, `GET /vods/clips?category=` | None functionally — already real, per-tab data, URL-addressable (`?tab=`) | Visual density polish only | No | Existing category page tests |
| `video_tile_medium` (duration/views/relative-date overlay badges) | VOD card metadata at a glance | `CategoryVodsGrid`/`VodCard`-equivalent | `GET /vods`, `GET /vods/trending` | Visual only — verify duration/view-count/relative-date badges are all present (audit during Phase 2 implementation) | Bring VOD card overlay badges to parity if any are missing | No | n/a unless a real field is missing |
| `clip_tile_large` (favorite/overflow/watch/share buttons) | Clip actions | `CategoryClipsGrid`/clip card | `GET /vods/clips`, `GET /vods/clips/trending` | Reference's favorite/share are **dead** — do not clone as interactive-looking-but-fake. Only add a share control if Birq has something real to share (a public clip URL — it does, `/clip/[id]` already exists per earlier session work) | If a share button is added, it must use the real Web Share API / copy-link to the real `/clip/[id]` URL, not a no-op | No | n/a unless share is added |
| `channel_tile_small` | Offline followed channel row | `CreatorCard` (muted variant) | Same as Following row above | None | — | No | — |

## Category data decision

The reference's category cards/header show cover art, a description, and
curated tags. Birq's `STREAM_CATEGORIES` (`packages/shared/src/constants.ts`)
is a flat 4-value string list (`Music`, `Gaming`, `Traditional`, `Just
Chatting`) with no metadata table, and no object storage pipeline for
category art exists today.

Two real options, not a fake-data shortcut either way:

1. **Generated visual system** (recommended for this pass): a deterministic
   gradient + icon per category, derived from the category name — no new
   table, no upload pipeline, no admin surface, and explicitly allowed by the
   asset policy ("category artwork: real Birq-owned image data **or an
   intentional generated visual system**"). Follower count and live viewer
   count are already real and already fetched — only the art is generated,
   never the numbers.
2. **Full `category_metadata` table** (admin-managed description, uploaded
   cover image, curated tags) — a real vertical slice (migration, admin
   route, object storage, public read API) but a materially bigger lift for
   4 static categories with no product request for admin-editable copy yet.

**Decision (closed):** option 1 was built and shipped — `components/CategoryTile.tsx`,
used on `/browse`'s Categories tab, `/discover`'s category rail, and (via the
same visual language) the category detail header. Option 2 remains explicitly
deferred, not silently dropped: no `category_metadata` migration, admin route,
or upload pipeline exists, and none should be started without a real product
decision on (a) whether categories need admin-editable descriptions/curated
tags at all for a 4-value fixed list, and (b) where uploaded cover art would
live (this repo has no object-storage pipeline wired up for anything today —
see GoLivePanel.tsx's own comment on thumbnailUrl being a client-compressed
data: URI specifically *because* no object storage exists yet). Revisit this
decision if/when Birq's category list stops being a small fixed set, since
that's the point at which a hardcoded per-category variant map (as
`CategoryTile.tsx` uses today) stops scaling.

## Non-functional controls intentionally NOT cloned

- Global cast icon (no Chromecast/AirPlay integration in Birq)
- Global comment/DM icon (no DM product surface in Birq)
- Category header cast/favorite icons beyond the real follow button
- Clip card favorite-heart and overflow "more" menu (no backing feature)
- Clip card "Watch full video" as a *second*, separate dead button — the
  card itself already navigates

## Summary

Of the reference's ~15 screens/components audited, **zero** require new
database tables to reach functional parity, **one** area (category cover
art/description) has a real, explicitly deferred data-modeling decision, and
the remaining gaps are visual-hierarchy work over already-real data paths.
This significantly narrows the required scope from "rebuild features" to
"apply the reference's information density to Birq's existing real data,"
plus two small, genuinely new real slices: a featured-live rail component and
a category-discovery rail on `/discover`, both built on data already being
fetched today.
