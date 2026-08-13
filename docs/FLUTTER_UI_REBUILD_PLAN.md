# Flutter reference — literal rebuild plan

Companion to `docs/FLUTTER_UI_REBUILD_AUDIT.md` — read that first for the
exact numeric specs this plan implements. Supersedes
`docs/TWITCH_UI_IMPLEMENTATION_PLAN.md`.

## Ground rules

- The Flutter reference's layout/density/spacing is the literal spec for
  everything **above** the bottom nav. The bottom nav itself (native 5-tab
  glass bar, web 4-tab glass bar, safe-area handling, native-shell
  suppression) is unchanged — verified against `RootTabView.swift` and
  `BottomNav.tsx`/`BottomNavClient.tsx` before any other work started.
- No Dart source, fonts, images, or Twitch branding — structural specs
  only, rebuilt with Birq's own type scale/tokens/real data.
- No dead UI: a control from the reference either gets a full, real vertical
  slice, or is hidden. Cast and global DM/comment are hidden this pass —
  documented in the audit as genuinely separate, large features, not
  silently dropped.
- Real data only: every category, count, tag, and stat traces to a
  Postgres row or a real computed aggregate — `content_categories` (new)
  replaces the flat `STREAM_CATEGORIES` array wherever the reference needs
  metadata the flat list can't carry.
- Prior Phase 1-4 CSS work is not preserved where it conflicts with the
  literal reference layout, per explicit instruction — committed and tested
  is not a reason to keep a layout the new direction supersedes.

## Type scale (Birq's own — the reference has no shared scale to port, see audit)

Derived from the reference's *recurring* hardcoded values (40px titles,
25px category name, 16/14/13/12px tiers) but implemented as real Birq
design tokens, not inline magic numbers:

- `--ref-title`: 40px / 700 / -0.02em — page titles (Following/Discover/Browse/Category name)
- `--ref-section-label`: 13px / 700 / uppercase / 0.06em — section headers
- `--ref-body-lg`: 16px / 500 — primary row text (usernames, clip titles)
- `--ref-body`: 14px / 400 — descriptions
- `--ref-caption`: 12px / 500 / var(--on-surface-variant) — category/game/meta line
- `--ref-badge`: 11px / 700 — overlay badges (duration/views/date/LIVE)

## Backend work (built before/alongside Browse, since Browse's Categories tab depends on it)

1. `db/migrations/0046_content_categories.sql` — `content_categories` +
   `category_tags`, seeded with Birq-owned copy for the 4 existing
   categories. `slug` matches `streams.category`/`category_follows.category`
   string values exactly — no FK change to those columns (too large a
   blast radius for a visual rebuild; see migration's own comment).
2. `packages/shared/src/schemas/categories.ts` — `contentCategorySchema`
   (public, with live-viewer/live-channel/follower aggregates),
   `createCategorySchema`/`updateCategorySchema` (admin).
3. `apps/api/src/categories/service.ts` + `routes.ts` — `GET /categories`,
   `GET /categories/:slug` (public), admin CRUD gated on `requireAdmin`
   (existing decorator, same pattern as every other admin route).
4. `apps/web/lib/api.ts` — typed helpers (`getCategories`,
   `getCategoryBySlug`).
5. Tests: API unit tests for the service, Playwright coverage for the
   Browse Categories tab consuming real catalog data.

## Phase order

### Phase A — Browse (first, per explicit priority — current screenshot is wrong)

- `ReferenceAppBar`, `UnderlineTabs`, `SectionLabel`, `MetadataChip`,
  `MediaStatusOverlay` primitives (shared across every subsequent phase).
- `CategoryRowCompact` (50×80 image, name, real viewer count, real tags,
  row layout) replaces the giant generated-gradient `CategoryTile` grid on
  Browse's Categories tab.
- `LiveCardLarge` replaces the current grid on Browse's Live Channels tab.
- Underline tabs (`TabBarIndicatorSize.label`-equivalent — underline sized
  to the label text, not the full tab) replace the rounded-pill tabs.
- 40px bold page title.
- Real language/tag/sort filters, URL query state, deep links, loading/
  empty/error states all preserved — filter logic itself is untouched,
  only the surrounding chrome/card system changes.

### Phase B — Following

- `LiveRowCompact` (120×70 fixed thumbnail, live dot + viewer count,
  avatar, title, category, tags) for the live section.
- `FollowingOfflineRow` for the offline section, with a **real unseen
  content count** (replacing the current boolean `hasNewContent`) —
  requires extending `getFollowedCreators`'s query from an `EXISTS` to a
  `count(...)` over the same VOD/clip union already there, plus a shared
  schema/API-helper/UI change. No new table.

### Phase C — Discover

- Featured-live rail becomes `LiveCardMedium` (370px fixed-width cards) in
  a peeking horizontal scroll (already scroll-snap from the prior pass;
  card component changes, scroll mechanism doesn't).
- `CategoryRailCard` (130×185) replaces the current generated-gradient
  category rail tiles.
- Real ranking signals only (`birqRank`, boosts, viewer count, recency) —
  unchanged data sources, new card components.

### Phase D — Category detail

- `CategoryHero` (100×140 cover, stat row, tag row, header layout per the
  audit's exact spec) replaces the current plain heading + stats line.
- Underline tabs, `LiveCardLarge` / `VodCardReference` / `ClipFeedCard` per
  tab.
- Real follow/unfollow, real live-viewer/follower stats (already
  available, see prior phase's work) — retained, re-skinned.

### Phase E — Watch/channel refinement

- Apply the same type scale/`MetadataChip`/`MediaStatusOverlay` primitives
  to the watch page's metadata row and VOD/clip surfaces for visual
  consistency with the rest of the rebuild.
- HLS playback, Centrifugo chat, PPV, moderation, follow — untouched,
  verified by diff each phase.

### Desktop adaptation

The reference is mobile-first with no desktop layout to port. Each phase's
component keeps the same information hierarchy at desktop width (1440px)
rather than reintroducing the old sidebar-and-generic-grid pattern by
default — `LiveChannelsSidebar` is audited per-page in Phase A and removed
from reference-driven pages where it conflicts, since streams must stay
discoverable through the rebuilt routes themselves, not a bolted-on side
list.

## Motion

- Rails: manual scroll + `scroll-snap`, no autoplay (unchanged from the
  prior pass).
- Tabs: 180ms underline transition.
- Cards: 120-160ms press feedback, not large hover jumps on mobile.
- Images: 150-200ms fade after real load.
- Follow/save: optimistic only after the real request starts, reconciled
  on response, visible error on failure.
- Loading: layout-matched skeletons, never a blank pane.
- LIVE badge: static, no pulse.
- `prefers-reduced-motion`: disables all of the above transforms.
- Bottom nav: untouched.

## Verification per phase

- `npm run typecheck --workspace=apps/web`
- Relevant API unit tests
- Relevant Playwright flows (new + existing, e.g. `discover-browse.spec.ts`
  needs updating once card components change)
- Manual render check at 390×844 (mobile) and 1440px (desktop)
- `git diff --check`
- Confirm every visible control has a real destination or real
  state-changing request — no new dead taps introduced

## Explicitly out of scope this pass (real, not placeholders — just not yet)

- Cast/AirPlay/Chromecast playback — no SDK integrated, control hidden.
- Global inbox/DM system — full vertical slice (threads, messages,
  blocking, real-time delivery, notifications) on the scale of the
  existing chat system; needs its own scoping pass, not a rebuild-phase
  side task.
- Clip favorite/save persistence — will follow the same real vertical-slice
  order (schema → migration → service → route → helper → UI → tests) when
  scheduled, not built as a rushed side effect of the Clips tab reskin.
- Admin UI panel for `content_categories` — the API (with `requireAdmin`
  auth) ships this pass; a dedicated admin table UI is a fast-follow, not
  blocking Browse/Discover/Category from reading real catalog data (the
  4 categories are seeded directly by the migration).
