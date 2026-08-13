> **SUPERSEDED** by `docs/FLUTTER_UI_REBUILD_PLAN.md`. Phases 1-4 in this
> document were implemented and shipped under the "loose inspiration"
> direction; several of their visual choices (the generated-art
> `CategoryTile` grid in particular) are explicitly being replaced under
> the new literal-rebuild direction. Do not use this phase plan for new
> work — see the rebuild plan instead.

# Twitch-inspired UI implementation plan

Companion to `docs/TWITCH_REFERENCE_FEATURE_AUDIT.md` — read that first for
why this plan's scope is narrower than "rebuild every screen." This
supersedes `docs/TWITCH_UI_ADAPTATION_BRIEF.md` (an earlier, less formal pass
at the same goal, partially executed — see Phase 1 below for what it already
delivered).

## Ground rules (apply to every phase)

- Never invent data. A number, badge, or list item on screen must trace to a
  real Postgres row or a real, currently-computed aggregate.
- Reuse existing API endpoints before adding new ones. The audit found zero
  required new endpoints for Phases 1–3.
- Preserve `components/BottomNav.tsx`'s glass styling, native-shell
  suppression (`birq_native` cookie / `BirqApp` UA check), safe-area
  handling, and its four real destinations (Explore, Following, Go Live,
  Wallet).
- Preserve all auth/PPV/moderation/rate-limit logic exactly. Styling changes
  never touch a permission decision.
- No new state/data-fetching stack — use the existing server-component fetch
  + `lib/api.ts`/`lib/clientApi.ts` pattern already in place.
- Every phase ends with: `tsc` typecheck, affected unit tests, affected
  Playwright flows, a manual mobile + desktop width check, and a console/
  network check for the changed pages.

## Phase 1 — Navigation and directory visual foundation

**Scope:** `components/BottomNav*`, `components/StreamCard*`,
`components/CategoryPills*`, `components/CreatorCard*`, `app/page.*`,
`app/following/page.*`, `app/discover/page.*`, `app/browse/page.*`. No
backend changes (audit found none required).

Delivered (partially pre-existing uncommitted work from
`TWITCH_UI_ADAPTATION_BRIEF.md`, completed and extended in this pass):

- Bottom nav: glass blur increased (22px + saturate), safe-area-aware
  padding on all sides (not just bottom), 48px min touch target,
  `:focus-visible` ring, active-tab background tint.
- `StreamCard`: hover lift + shadow, `:focus-visible` ring, live badge
  recolored, reduced-motion guard, container-query responsive layout
  unchanged.
- `CategoryPills`: translucent pill background, `:focus-visible` ring on
  both states, min 36px height.
- `CreatorCard`: hover lift + shadow, `:focus-visible` ring, 44px+ min
  height, reduced-motion guard — brought to parity with `StreamCard`.
- Page-level typography scale unified across `/`, `/following`, `/discover`,
  `/browse`: headline weight 700, `clamp(22px, 3vw, 28px)` heading size,
  `-0.025em` tracking, consistent section-heading weight/size, responsive
  grid `minmax(min(100%, Npx), 1fr)` (prevents overflow at very narrow
  widths — a real bug in the pre-existing fixed-px `minmax` on small
  screens), `:focus-visible` on every remaining interactive text link
  (`browseLink`, `clearFilter`, `discoverLink`, tabs, category tiles).
- `prefers-reduced-motion: reduce` guards added everywhere a hover
  transform/transition was added.

**Verification:** see "Phase 1 verification" below.

## Phase 2 — Following and Discover

**Scope:** real, already-available signals surfaced with no new backend
work, plus one new UI-only component (a rail) over already-fetched data.

1. **Discover — featured-live rail.** Replace the "Featured live" CSS grid
   with a horizontally-scrolling, scroll-snap rail (reuses `StreamCard`,
   same `isBoosted` data already fetched in `app/discover/page.tsx`). Real
   interaction: arrow-key/scroll navigation, no new state.
2. **Discover — category rail.** New section using the same tile treatment
   as Browse's category grid (§ Category data in the audit — generated
   visual, real per-category follower count already returned by
   `getCategoryFollowStatus`, real live-viewer count computed by summing
   `viewerCount` over `GET /streams/live` filtered per category — one extra
   pass over data already fetched, not a new query). Tap navigates to the
   real `/category/[slug]`.
3. **Following — richer live-card metadata.** Verify `CreatorSearchResult`
   carries stream title; if not, this is the one place Phase 2 may need a
   narrow, additive field on the existing `follows/mine` response (no new
   table — `streams` already has `title`), added the required way: shared
   schema → service query column → route → typed API helper → UI.
4. **Category header stats.** Add the `N viewers now` / `N followers` row to
   `app/category/[slug]/page.tsx` from data already in hand
   (`getCategoryFollowStatus`'s `followerCount`, live-stream sum) — zero new
   backend calls.

No migration required for Phase 2. Every new number is a real aggregate over
already-fetched or trivially-added existing columns.

## Phase 3 — Browse and category journeys

**Scope:** category tile visual upgrade (generated art system), confirming
every tab in Browse/Category is fully wired (audit found they already are),
no share/cast controls added anywhere they don't have a real target.

1. Generated category-art component: deterministic gradient (derived from a
   hash of the category name → hue) + a category-appropriate icon from the
   existing icon set, applied to both Browse's category tiles and Discover's
   new category rail. No image upload, no new table — a pure presentation
   component, explicitly the "generated visual system" option from the
   audit.
2. Re-verify Browse's existing language/tag/sort filters and category tabs
   render correctly with the new card geometry (regression check only — the
   filters themselves are unchanged and already real).
3. Document the deferred `category_metadata` table (admin-editable
   description/art/curated tags) as a Phase 5 candidate requiring product
   sign-off — not built in this plan.

## Phase 4 — Watch/channel refinement

**Scope:** visual hierarchy only. Live HLS playback, Centrifugo chat, PPV
gating, moderation, and follow state are already real (confirmed across
earlier work this engagement) and must not be touched functionally.

1. Audit `app/watch/[username]/page.tsx` against the reference's density
   (creator identity block, category/tags visible without scrolling, viewer
   count prominence) and tighten spacing/typography to match Phase 1's
   scale.
2. No new endpoints expected — flag during implementation if one is found
   genuinely missing (e.g., a metadata field the page needs but the API
   doesn't return).

## Phase 5 — Any missing full-stack feature (conditional)

Only entered if Phase 1–4 implementation surfaces a real, confirmed gap not
already covered — e.g., the deferred `category_metadata` table, if product
sign-off is given. Follows the mandatory order: shared schema → migration →
service → route → typed helper → UI → tests, same as every other slice in
this plan.

## Phase 1 verification

- `npm run typecheck --workspace=apps/web`
- Manual review: `/`, `/following`, `/discover`, `/browse` at 375px (mobile)
  and 1440px (desktop) widths, light and dark theme
- Confirm bottom nav stays fixed, glassy, and hidden under
  `BirqApp`/`birq_native` conditions (unchanged logic, not touched)
- Confirm every existing interactive element still navigates/mutates
  exactly as before — this phase changed only CSS and did not touch any
  `onClick`/`href`/data-fetching logic
- `git diff --check` for whitespace errors

## What this plan explicitly does not do

- Does not add a cast/share control anywhere without a real transport
- Does not create a `category_metadata` table without product sign-off
  (documented as deferred, not silently skipped)
- Does not replace Birq's bottom nav with the reference's 3-tab bar
- Does not fabricate viewer counts, follower counts, "trending" labels, or
  recommendation lists — every number added traces to a real query
