# Birq Flutter Consumer — AI implementation rules

## Status and authority

This document is the implementation authority for the **new Flutter consumer
app**. It supersedes the visual direction in `FLUTTER_UI_REBUILD_AUDIT.md`
and `FLUTTER_UI_REBUILD_PLAN.md` wherever they conflict.

The visual source of truth is the Vercel design archive:

`/Users/adem/Desktop/birq (1).zip`

It is a visual prototype only. Its React/Next.js implementation and
`lib/mock-data.ts` are **not** production code and must never be copied into
the real app as data or behavior.

The existing Birq systems remain authoritative for product behavior:

- web/API repository: `/Users/adem/Downloads/stitch_ethiostream/habeshalive`
- iOS Swift host and Go Live stack: `/Users/adem/Downloads/moblin-main`
- Fastify API, Postgres schema, authentication, HLS, chat, wallet,
  moderation, follows, VODs, clips, and notifications.

## Product architecture

Build a Flutter **consumer module** embedded into the existing Swift iOS app.
Do not replace the native Go Live/camera/streaming stack. The intended
architecture is:

```text
Flutter consumer UI <-> typed Fastify API <-> existing services/Postgres
        |
        +-> Swift bridge for native Go Live and host-only capabilities
```

The existing Next.js app remains the browser/desktop product. Flutter is the
new mobile consumer surface, not an automatic conversion of the Vercel app.

## Non-negotiable design rules

1. Recreate the Vercel prototype's Birq visual language in Flutter:
   purple gradient, typography, glass navigation, blue active state, live
   red, translucent surfaces, image-first cards, and mobile-first spacing.
2. Extract reusable Flutter design tokens and widgets before rebuilding
   feature screens. Do not scatter literal colors, radii, or spacing values.
3. Use Birq-owned, licensed, or generated visual assets only. Do not ship
   Twitch branding, copied creator imagery, or unverified game artwork from
   the prototype.
4. Use a real, intentional loading/empty/error state. Never add fake content
   to make a screen look full.
5. Preserve accessibility: dynamic text where practical, semantic labels,
   adequate targets, contrast, keyboard support where applicable, and reduced
   motion.
6. Motion must support orientation, not distract: retained tab state, subtle
   160–220ms transitions, no forced autoplay, and no large page-slide effect.

## No dead UI rule

Every display value and action must have a real path:

```text
Flutter UI -> typed API client -> Fastify route -> service/query -> database
or real-time provider
```

If a Vercel prototype interaction has no real Birq capability:

- implement the smallest complete backend-to-UI slice; or
- defer/hide it; or
- show a truthful unavailable state if that is an approved product decision.

Never use `mock-data.ts`, local fake balances, fake viewers, static streams,
hard-coded recommendations, client-only follow state, demo comments, or fake
authentication.

## Route and feature rules

| Flutter destination | Birq behavior |
| --- | --- |
| Explore / Discover / Browse | Real live streams, categories, rankings, search links |
| Following | Real follows and real unseen VOD/clip state |
| Category | Existing category catalog, aggregates, live/VOD/clip data |
| Watch | Real HLS, chat, follows, PPV, moderation, authorization |
| Search | Existing search API |
| Wallet | Real balances, points, transactions, withdrawal state |
| Profile | Real profile/settings; never route Profile to creator `/account` |
| Activity | Real notifications only |
| Go Live | Swift-native host via a documented MethodChannel contract |
| Whispers/messages | Do not build until a real messaging backend is approved |
| Games | Map to real categories until a real games domain is designed and built |

For signed-out users, Explore and other public content remain usable.
Protected destinations must use one unified sign-in flow that preserves the
requested destination; do not create duplicate login pages per tab.

## Native integration rules

1. Use a persistent Flutter engine and explicit Swift/Flutter navigation
   contract.
2. Define every MethodChannel name, method, argument, return value, and error
   in a documented typed contract.
3. Preserve the existing Swift Go Live stack until a separately approved
   replacement exists.
4. Do not reintroduce the historical WKWebView touch crash or use speculative
   gesture workarounds.
5. Profile must resolve to the real settings/profile experience, not the
   creator dashboard.

## Authentication and security rules

1. Audit the existing Birq mobile authentication contract before writing the
   Flutter client. Do not assume browser cookies are sufficient for Flutter.
2. Store mobile credentials only in platform secure storage and use the
   existing server-issued session/token model.
3. Preserve existing Fastify authorization checks; Flutter UI is never an
   authorization boundary.
4. Do not log access tokens, refresh tokens, cookies, DATABASE_URL, or any
   secret.

## Performance rules

1. Use lazy `ListView.builder`, `SliverList`, or equivalent for feeds.
2. Retain selected-tab navigation and scroll state with an `IndexedStack` or
   equivalent approach.
3. Paginate feeds/chat/notifications; never load unlimited history.
4. Cache and size images deliberately; avoid expensive blur, clipping, and
   per-frame rebuild work.
5. Measure perceived launch, warm tab-switch, scroll, and video/chat behavior
   on real/profile builds before claiming performance success.

## Engineering process

1. Begin each phase with a source/data audit and a route-to-contract map.
2. Keep changes scoped. Do not rewrite the API or native streaming system just
   because Flutter is being added.
3. Add or update tests with each real behavior change.
4. Run formatting, static analysis, Flutter unit/widget tests, integration
   tests, applicable API tests, and native build verification.
5. Capture mobile visual evidence at 390×844 and a larger-device layout before
   calling a screen complete.
6. Make small, descriptive commits. Never stage unrelated existing files.

## Deployment and production rules

Do not deploy anything, apply production migrations, access Fly SSH, retrieve
`DATABASE_URL`, or print production secrets unless the owner gives explicit,
separate approval for that specific release.

Use local/test infrastructure only for development and tests. A production
release requires a dedicated review of migrations, API compatibility, Flutter
build artifacts, rollback steps, and health checks.

## Completion criteria

The Flutter consumer work is complete only when:

- the Vercel Birq skin is implemented as reusable Flutter design primitives;
- every shipped screen is real-data-backed and accessible;
- public/protected navigation works cleanly;
- Go Live handoff to Swift works;
- Watch/HLS/chat and wallet/profile flows are functional;
- profile routing is correct;
- mobile performance is measured, not assumed;
- tests and native builds pass; and
- release approval is explicitly obtained.
