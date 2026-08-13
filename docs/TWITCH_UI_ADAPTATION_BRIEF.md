> **SUPERSEDED.** This brief treated the Flutter reference as loose UX
> inspiration ("recognizably Birq, not a literal Twitch clone"). The user
> has since explicitly reversed that direction: the Flutter reference is
> now the literal layout/density/component specification, with only the
> glass bottom nav protected. See `docs/FLUTTER_UI_REBUILD_AUDIT.md` and
> `docs/FLUTTER_UI_REBUILD_PLAN.md`. Kept here as historical record of the
> earlier, now-overridden direction — do not follow this document.

# Twitch-inspired UI adaptation — implementation brief

## Product goal

Give Birq the information architecture and interaction clarity of the
[`fluttership/Twitch-Clone-Flutter`](https://github.com/fluttership/Twitch-Clone-Flutter)
reference while keeping Birq's brand, the existing **glassy fixed bottom
navigation**, and every current screen connected to real Birq data.

The reference is a visual study, not an application architecture. Do not copy
its Dart widgets, mock lists, assets, name, or brand. Recreate only the useful
interaction patterns with Birq components and APIs.

## Facts discovered in this repository

| Reference surface | Birq destination | Existing real data path |
| --- | --- | --- |
| Following | `/following` | `GET /follows/mine`, `POST /follows/mine/seen` |
| Discover | `/discover` | `GET /streams/live`, `/vods/trending`, `/vods/clips/trending` |
| Browse categories / channels | `/browse` | `GET /streams/live` with category, language, tag, and sort filters |
| Category channels / videos / clips | `/category/[slug]` | Streams plus category VOD and clip endpoints |
| Channel watch | `/watch/[username]` | Live HLS playback, chat, follows, PPV, squad and creator data |
| Notifications | current bell and settings | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |

The platform already has the database-backed API and tables for these
surfaces. A visual change must consume those existing paths. Never replace a
real result with a hard-coded card, count, category, user, or CTA.

## Non-negotiable UX constraints

1. Keep `components/BottomNav.tsx` and the frosted-glass behavior in
   `components/BottomNav.module.css`. It remains fixed at the bottom on web;
   it remains hidden in the native WKWebView shell to avoid duplicate native
   tabs.
2. Preserve routes and deep links. Tabs, category chips, stream cards,
   creator profiles, filters, search results, notification actions, and
   primary CTAs must navigate or mutate real state.
3. Preserve all authorization, PPV, moderation, rate limiting, and backend
   validation. Styling never moves a permission decision into the browser.
4. Responsive behavior is part of the work. Mobile must reserve safe-area
   space for the glass bar; desktop must continue to work with its live-channel
   sidebar and top navigation.
5. Preserve empty, loading, error, and unauthenticated states. Do not conceal
   missing data with invented content.
6. Reuse Birq's tokens, translations, `next/link`, API helpers, TypeScript
   types, and shared schemas. Do not add a second state/data-fetching stack.

## Visual direction to adapt

- A dense streaming-first hierarchy: prominent live content, visible `LIVE`
  and viewer status, creator avatar/name, category and language metadata.
- Horizontally scrollable, selected category controls with a clearly visible
  active state.
- Clear separation of **Following**, **Discover**, and **Browse**: Following
  answers “who I follow is live”; Discover answers “show me something now”;
  Browse answers “I know what I want.”
- Category landing pages with explicit **Live / Videos / Clips** tabs.
- Consistent card geometry, 16:9 media, readable metadata, keyboard focus,
  and touch targets of at least 44px.
- Use Birq's own typography, purple/accent variables, and visual voice. The
  output should feel inspired by the reference, not branded as Twitch.

## API and database rule for new interactions

Before a new visible control is added, make this table during implementation:

| UI action | Web request | API handler/service | DB effect/query | Verification |
| --- | --- | --- | --- | --- |

If an equivalent endpoint already exists, use it. If it does not, build the
vertical slice in this order: shared input/output schema → SQL migration with
indexes/constraints → service with ownership/authorization rules → Fastify
route with validation and rate limiting → web API helper → UI state and
success/error states → unit/e2e test. No UI control is complete without all
applicable columns filled in.

## Phased delivery order

### Phase 1 — visual foundation (no backend change expected)

Audit and normalize stream cards, category pills, headings, metadata rows,
empty states, and page spacing across `/`, `/following`, `/discover`, and
`/browse`. Keep their current server-side fetches and client polling intact.
Do not touch user-owned uncommitted work in `components/StreamCardPreview.tsx`.

### Phase 2 — browse and category journeys (no mock data)

Make category browsing visually coherent from the home chips through
`/browse` and `/category/[slug]`. Retain real filter query parameters and the
live/videos/clips data. Validate selected-tab and selected-filter URL states.

### Phase 3 — watch and social interactions

Improve the watch header, channel metadata, follow control, chat affordances,
clip/VOD discovery, notifications, and contextual actions. Retain live HLS,
Centrifugo chat, PPV, follows and moderation checks exactly as implemented.

### Phase 4 — optional new capability

Only if a reference-inspired interaction has no Birq equivalent, create its
full vertical slice under the API/database rule above. Write the migration and
tests in the same change; do not ship a visually enabled but non-functional
button.

## Definition of done for each phase

- It uses production-shaped API data, including empty/error/unauthenticated
  cases.
- Every button, card and tab has an intentional behavior.
- Desktop, narrow mobile and safe-area layouts are checked.
- Existing auth, backend API and database contracts remain intact.
- Relevant unit tests and the affected Playwright journey pass, plus
  workspace typecheck/build as appropriate.

## Implementation prompt

> You are implementing Phase `<N>` of Birq's Twitch-inspired UI adaptation.
> Treat `docs/TWITCH_UI_ADAPTATION_BRIEF.md` as the source of truth. Inspect
> the existing route, component, API helper, Fastify route/service, shared
> schema, SQL migration history, and relevant tests before changing code.
> Use the Flutter reference only for UX patterns; do not copy its code, static
> content, assets, Twitch branding, or fake data. Preserve Birq's fixed glass
> bottom navigation exactly, including its native-shell suppression. Reuse
> existing live-stream, follow, category, VOD, clip, notification and chat
> capabilities where they exist. For every new user action, provide a real
> typed web request, authorized/validated API handler, database read/write (if
> state changes), loading/error/success states, and tests. Do not create dead
> UI. Preserve deep links, accessibility, responsive layout, i18n, user-owned
> uncommitted changes, and security controls. Finish by running targeted tests
> and typecheck, then report the exact routes, API endpoints, DB migrations and
> verification performed.
