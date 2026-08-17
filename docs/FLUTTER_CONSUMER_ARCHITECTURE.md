# Birq Flutter consumer — architecture

**Status:** Phase 0 complete — audit-backed, no assumptions. Authority:
`docs/AI_RULES_BIRQ_FLUTTER_CONSUMER.md`.

This document maps the Vercel visual prototype (`/Users/adem/Desktop/birq (1).zip`,
a Next.js "concept redesign" per its own `app/layout.tsx` metadata — not
production code) onto a new Flutter consumer module embedded in the existing
Swift iOS host at `/Users/adem/Downloads/moblin-main/flutter_consumer`, wired to
the real Fastify/Postgres backend at
`/Users/adem/Downloads/stitch_ethiostream/habeshalive`.

## 1. Vercel design tokens

Extracted from `app/globals.css`, `components/bottom-nav.tsx`, and
`components/phone-shell.tsx` in the archive.

### Color

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#1a1030` | App background, gradient bottom stop |
| `foreground` | `#ffffff` | Primary text |
| `primary` (Birq purple) | `#7d3cff` | Active states, CTAs, focus ring |
| `live` | `#e91916` | Live badges, Go Live CTA, destructive |
| `brand-orange` | `#ff5a1f` | Wordmark gradient / "NEW" badges |
| `brand-magenta` | `#d61f7a` | Wordmark gradient / balance card gradient end |
| `surface` | `rgba(255,255,255,0.08)` | Translucent card fill |
| `surface-strong` | `rgba(255,255,255,0.14)` | Emphasized translucent fill |
| `nav` | `#0d1526` | Bottom nav pill background (95% opacity + blur) |
| `nav-active` | `#4f8ff7` (blue) | Active tab icon chip + label |
| `border`/`input` | `rgba(255,255,255,0.12)` | Hairlines |
| `muted-foreground` | `rgba(255,255,255,0.6)` | Secondary text |

Gradient backdrop (`bg-app-gradient`, used on Explore/Wallet/Profile/Go
Live/Watch/Login/Splash):
`radial-gradient(120% 80% at 50% 0%, #6a4aa8 0%, #4a2f7d 45%, #1a1030 100%)`

Dark flat backdrop (`bg-app-dark`, used on Following/Search/Games/Activity/
Whispers): flat `#0a0a0f`.

### Typography

Font family: Plus Jakarta Sans (Google Font). Birq does not have a licensed
copy of this specific font family confirmed for mobile use — see §6 Asset
provenance. Scale observed across screens (Tailwind classes → px):

| Class | Size | Weight | Use |
| --- | --- | --- | --- |
| `text-4xl font-bold` | 36px / 700 | Screen titles (Explore, Wallet, Profile, Go Live) |
| `text-3xl font-bold` | 30px / 700 | Sub-titles (Comment header, Splash wordmark) |
| `text-2xl font-bold` | 24px / 700 | Section headers |
| `text-xl font-bold` | 20px / 700 | Card titles, streamer name |
| `text-lg font-bold/semibold` | 18px / 600–700 | Tab labels, list titles |
| `text-base font-medium/semibold` | 16px / 500–600 | Body, buttons |
| `text-sm` | 14px / 400–600 | Secondary text, meta |
| `text-xs` | 12px / 500 | Nav labels, badges |
| `text-[10px]/[11px]` | 10–11px / 700 uppercase | LIVE badges |

### Spacing / radii

- Screen horizontal padding: `px-5` (20px) or `px-6` (24px) depending on
  screen density.
- Card radius scale: `rounded-xl` (12px), `rounded-2xl` (16px), `rounded-3xl`
  (24px) for the wallet balance card.
- Bottom nav pill radius: 26px, `border border-white/10`, `backdrop-blur-xl`,
  shadow `0 8px 30px rgba(0,0,0,0.45)`.
- Avatar rings: 2px solid, `ring-primary` or `ring-white/30`.

### Navigation shell

`PhoneShell` = full-height column: gradient/dark background → scrollable
content → sticky `BottomNav`. Five tabs, exact match to Birq's existing
protected nav set — **not a coincidence to preserve, a hard constraint**:

| Icon | Label | Route match | Notes |
| --- | --- | --- | --- |
| Compass | Explore | `/explore`, `/games`, `/search`, `/live`, `/home` | fills background pill blue when active |
| Heart | Following | `/following` | icon *fills* solid when active (`fillOnActive`) |
| Video | Go Live | `/go-live` | center position |
| Wallet | Wallet | `/wallet` | |
| User | Profile | `/profile`, `/activity`, `/whispers` | |

Active state: `size-9` circular blue (`nav-active` `#4f8ff7`) chip behind the
icon, blue label text. Inactive: `white/80` icon, `white/70` label, no chip.

This is a **different visual treatment** from Birq's current production glass
nav (dark navy pill + blue fill vs. the existing app's own glass nav design)
but the **same five destinations in the same order** as
`moblin-main/Birq/View/RootTabView.swift`'s `RootTab` enum. Flutter's new
`BirqGlassBottomNav` primitive (§ Phase 1) reproduces the Vercel visual
(pill shape, blur, blue active chip) bound to Birq's real five routes —
visual skin from Vercel, route set from the existing native app.

### Cards / states

- **Image-first**: every card leads with a 16:9 (`aspect-video`) or 3:4
  thumbnail; text sits below or as an absolute-positioned gradient overlay
  (`bg-gradient-to-t from-black/50 to-transparent`) never a separate hero
  block above the image.
- **Live badge**: `bg-live` (red) pill, `10–11px/700/uppercase`, "LIVE" text,
  positioned `top-left` on grid cards, or a small dot + viewer count on
  compact rows.
- **Viewer count pill**: `bg-black/60` translucent pill, white text, eye
  icon, bottom-left of thumbnail.
- **Empty/loading state**: not designed in the prototype (no empty states
  exist — every mock array is non-empty). Flutter must design its own
  `BirqEmptyState`/`BirqSkeleton` since the prototype gives no guidance here;
  see § Non-negotiable rule 4 in the AI rules doc.

### Motion

No real transition/animation code exists in the prototype beyond a CSS
`animate-pulse` on the splash logo and `active:scale-[0.99]` press feedback
on primary buttons. Birq's own rule (160–220ms, retained tab state, no
forced autoplay) governs Flutter's actual motion design; the prototype is
silent on this.

## 2. Route map

Vercel prototype route → Flutter route → existing Birq API/feature → status.

| Vercel route | Flutter route | Birq capability | Status |
| --- | --- | --- | --- |
| `/` (splash) | `/splash` | none (client-only boot screen) | Build as-is (Phase 1) |
| `/login` | `/login` (sheet or route, see § Auth) | `POST /auth/login`, OTP routes | Build real, not the mock's hardcoded email/instant-redirect |
| `/home` (fullscreen swipe feed) | Folded into `/watch/:username` as the default immersive layout; **not** a separate route | `GET /streams/live`, HLS `playbackUrl` | Re-scope: prototype's TikTok-style swipe feed has no Birq equivalent (no "next random live stream" endpoint) — implement the real Watch screen instead (see Phase 3), defer swipe-to-next-stream as a later feature, not fabricated |
| `/explore` | `/explore` | `GET /streams/live`, `GET /categories`, `GET /follows/mine` (watch history has no real equivalent — see § below) | Build real (Phase 3) |
| `/games`, `/games/[id]` | `/browse` (category grid), `/category/:slug` | `GET /categories`, `GET /categories/:slug` | Map "Games" grid to Birq's real category catalog per AI rules — do not invent a games domain |
| `/search` | `/search` | existing search API (creators + streams) | Build real (Phase 3) |
| `/live/[id]` | `/watch/:username` | `GET /streams/:username` (or equivalent), HLS, Centrifugo chat, follow, PPV | Build real, full functionality preserved even though the mock only has a static image + fake comments (Phase 3) |
| `/following` | `/following` | `GET /follows/mine`, live/offline split, unseen-content count | Build real (Phase 4) |
| `/wallet` | `/wallet` | wallet balance/points/transactions/withdrawal routes | Build real (Phase 4) |
| `/profile` | `/profile` | `GET /account/me` (or equivalent "my account" route), own VODs | Build real (Phase 4); routes to real settings, never `/account` creator dashboard per AI rules |
| `/activity` | `/activity` | `notificationSchema`-backed list + unread count + mark-read | Build real (Phase 4) — real schema exists (`packages/shared/src/schemas/notifications.ts`); confirm routes in § 3 |
| `/whispers` | *(not built)* | none — no messaging backend | **Explicitly deferred** per AI rules ("Do not build Whispers/messages until a real messaging backend is designed"). Hide the destination entirely; do not ship a placeholder screen |
| `/go-live` | Go Live tab invokes the **native Swift** Go Live flow via MethodChannel; no Flutter screen | `startCaptureStackIfNeeded()` and the existing HaishinKit/SRS publish pipeline in `moblin-main` | Bridge only — the prototype's camera-preview/title/game-picker screen is **not** rebuilt in Dart; Swift already owns this real capability (Phase 2) |

## 3. Data-contract map

UI → typed Dart client → Fastify route → service/query → database/realtime.
Confirmed by direct inspection of `apps/api/src/**/routes.ts` and
`packages/shared/src/schemas/*.ts` (not assumed). Every response is wrapped
`{success, data, error}` by `app.ts`'s `preSerialization` hook — the Dart
client unwraps `data` once, centrally, mirroring `apps/web/lib/api.ts`'s
`unwrapData`.

| Flutter screen/action | Dart client method | Route | Auth |
| --- | --- | --- | --- |
| Splash → session restore | `AuthApi.me()` | `GET /auth/me` | Bearer |
| Login (email/phone + password) | `AuthApi.login()` | `POST /auth/login` | public |
| Login OTP | `AuthApi.requestOtp/verifyOtp()` | `POST /auth/request-otp`, `/verify-otp` | public |
| 2FA challenge | `AuthApi.verifyTotpLogin()` | `POST /auth/2fa/login-verify` | pendingToken in body |
| Logout / revoke device | `AuthApi.revokeSession()` | `POST /auth/revoke-session` | Bearer |
| Explore/Discover/Browse feed | `StreamsApi.live()` | `GET /streams/live?category=&language=&tag=&sort=` | public (personalizes if Bearer present) |
| Category catalog | `CategoriesApi.list()` | `GET /categories` | public |
| Category detail | `CategoriesApi.bySlug()` | `GET /categories/:slug` | public |
| Search | `SearchApi.search(q)` | `GET /search?q=` | public |
| Watch — stream by creator | `StreamsApi.byUsername()` | `GET /streams/username/:username` | public |
| Watch — HLS playback | player consumes `StreamDetail.playbackUrl` directly | (signed URL, no separate call) | — |
| Watch — viewer list | `StreamsApi.viewers()` | `GET /streams/:id/viewers` | public |
| Watch — chat connect | `ChatApi.token()` + Centrifugo WS | `POST /chat/token`, WS to `stream-chat:<id>` | public/Bearer |
| Watch — chat history catch-up | `ChatApi.messages()` | `GET /chat/:streamId/messages` | public |
| Watch — send chat message | `ChatApi.send()` | `POST /chat/:streamId/messages` | Bearer, not-banned |
| Watch — follow toggle | `FollowsApi.toggle()` | `POST /follows/:creatorId` | Bearer |
| Watch — PPV purchase | `StreamsApi.purchasePpv()` | `POST /streams/:id/ppv/purchase` | Bearer, not-banned |
| Watch — VODs/clips for creator | `VodsApi.byUsername()/clipsByUsername()` | `GET /vods/:username`, `/vods/:username/clips` | public |
| Discover — trending VODs/clips | `VodsApi.trending()/trendingClips()` | `GET /vods/trending`, `/vods/clips/trending` | public |
| Following feed | `FollowsApi.mine()` | `GET /follows/mine` | Bearer |
| Following — mark seen | `FollowsApi.markSeen()` | `POST /follows/mine/seen` | Bearer |
| Wallet — balance/points | `WalletApi.balance()`, `PointsApi.balance()` | `GET /wallet/balance`, `/points/balance` | Bearer |
| Wallet — transactions | `WalletApi.transactions()` | `GET /wallet/transactions` | Bearer |
| Wallet — top up | `WalletApi.topup()` | `POST /wallet/topups` → open `checkoutUrl` (Chapa-hosted, third-party) in an in-app browser tab | Bearer |
| Wallet — payout request | `WalletApi.requestPayout()` | `POST /wallet/payouts` | Bearer |
| Profile/settings — read | `AuthApi.account()` | `GET /auth/account` | Bearer |
| Profile/settings — edit | `AuthApi.updateProfile()` etc. | `PATCH /auth/account/profile` etc. | Bearer |
| Activity/notifications | `NotificationsApi.list()/unreadCount()` | `GET /notifications`, `/notifications/unread-count` | Bearer |
| Activity — mark read | `NotificationsApi.markRead()/markAll()` | `POST /notifications/:id/read`, `/read-all` | Bearer |
| Activity — realtime badge | Centrifugo `notifications:<userId>` channel | same chat token contract | Bearer (for `sub`) |

Full per-feature-area route catalogs (auth, streams, categories, follows,
search, chat, vods/clips, PPV, wallet, notifications, moderation) were
independently confirmed by direct inspection of every `apps/api/src/**/
routes.ts` file; the table above is the subset the approved Phase 3/4
screens actually call. **Confirmed: nothing is genuinely missing
for the approved consumer scope** — every screen maps onto a real, already-
shipped route. The only two areas explicitly out of scope (Whispers/
messaging, a real Games domain) correctly have no route entries here,
matching the AI rules doc's deferral.

## 4. Auth architecture

### The existing contract (confirmed, not assumed)

`POST /auth/login` (and every OTP/2FA/social login-completing route)
`reply.jwtSign({ sub, role, jti })`s a **non-expiring bearer JWT** and
returns it directly in the response body as `{ token, user }`
(`authResponseSchema`) — nothing is cookie-based server-side. The existing
web app's httpOnly cookie is purely a *web-layer* choice
(`apps/web/lib/session.ts` stores this same token string inside a cookie);
the native Swift broadcaster login (`ModelBirq.birqLogin`) already consumes
this exact same `POST auth/login` response shape and stores the raw token.
There is no refresh-token endpoint — tokens don't expire; `jti` maps to a row
in `sessions`, and `POST /auth/revoke-session` is the only invalidation path
(also usable as "log out this device" or "log out remotely"). Session
restore is therefore just: keep the stored token, call `GET /auth/me` on
launch to validate + hydrate the user, and treat a global `401` as "signed
out."

### What Flutter does

Flutter's consumer auth is a **direct, independent client of this same real
contract** — not a wrapper around any WKWebView cookie, and not a new
authentication scheme:

1. **Login/signup UI is real native Dart**, calling
   `POST /auth/login` / `POST /auth/request-otp` + `/verify-otp` /
   `POST /auth/request-email-otp` + `/verify-email-otp` /
   `POST /auth/2fa/login-verify` directly — the same JSON contract the
   Swift host already speaks. This is *not* an embedded WKWebView login
   form; per the AI rules doc ("Do not assume browser cookies are
   sufficient for Flutter... do not invent native authentication"), the
   correct reading is: use the *existing token-issuing endpoints* through a
   real Dart UI, which is exactly what the native broadcaster login already
   does — Flutter is just a second, independent consumer of the same
   primitive.
2. **Storage**: `flutter_secure_storage` (iOS Keychain-backed,
   `kSecClassInternetPassword` under the hood on iOS, matching the app's
   only existing Keychain usage pattern in `Birq/Various/Keychain.swift`).
   To stay consistent with that pattern without colliding with it — the
   existing `stream.birqToken` entry is keyed
   `server: "com.birq.mobile.auth"`, `account: <SettingsStream UUID>` (a
   broadcaster-profile identity, not a viewer identity) — Flutter's viewer
   session uses a **distinct, clearly-namespaced server string**:
   `server: "com.birq.mobile.auth.viewer"`, `account: "current"` (a single
   fixed key; Flutter has exactly one signed-in viewer at a time, unlike the
   multi-`SettingsStream` broadcaster model). Different server string is
   deliberate: these are two genuinely different credentials for two
   genuinely different roles (broadcaster vs. viewer), the same separation
   the existing `BirqWebSessionState` header comment already insists on
   between `stream.birqLoggedIn` and the web `session` cookie. They are
   **not** unified into one login — signing in as a viewer in Flutter does
   not sign in the native Go Live broadcaster identity, and vice versa,
   exactly preserving today's behavior.
3. **Every Dart HTTP call** attaches `Authorization: Bearer <token>` (a thin
   `ApiClient` wrapper, §Phase 1). A global `401` interceptor clears stored
   auth state and routes to the signed-out UI.
4. **Signed-out/protected-tab behavior** — the Flutter-native equivalent of
   the existing `BirqWebSessionState` + `BirqSignInSheet` pattern, rebuilt
   as Dart state instead of a cookie observer: a `Riverpod`/equivalent
   `AuthState` provider holds `isSignedIn`; tapping Following/Wallet/
   Profile/Activity while signed out intercepts the tab change (same
   "allow the selection, then snap back and show the sheet" pattern already
   proven in `RootTabView.swift`) and presents **one shared native sign-in
   route** (a full Dart screen/sheet, not per-tab duplicates), preserving
   the intended destination and navigating there after success — this
   literally re-implements the already-approved Commit-3 UX from the web/
   native rebuild, just in Dart instead of SwiftUI+WKWebView.
5. **Wallet top-ups** are the one place a hosted web page is unavoidable
   (Chapa's own checkout UI). `POST /wallet/topups` is called with Flutter's
   own Bearer token directly (no bridge-code needed — this route doesn't
   need a *birq.live* cookie session, it needs Flutter's own auth, which it
   already has) and returns `{checkoutUrl}`; Flutter opens that third-party
   URL via `url_launcher`/an in-app Safari view (`SFSafariViewController`),
   not a raw `WKWebView` — sidestepping the historic WKWebView touch-crash
   risk entirely rather than re-managing it. The existing
   `POST /auth/web-bridge-code` mechanism (mobile token → web cookie) is
   **not needed by Flutter's own screens** — it existed specifically to let
   an embedded *birq.live web page* render as if browser-logged-in, which
   no longer applies once those four tabs are real Dart/native screens
   instead of embedded web pages.

## 5. Swift/Flutter bridge contract

### Architectural shape

Flutter becomes the **persistent app shell**: a single long-lived
`FlutterEngine`/`FlutterViewController`, hosting Flutter's own
`BirqGlassBottomNav` (the Vercel-skinned recreation of today's 5-tab bar —
Explore, Following, Go Live, Wallet, Profile, same order, same protected-tab
set) and every screen except Go Live. `RootTabView.swift` is rewritten to
mount this Flutter view in place of its current `TabView`; the outer
SwiftUI scene/App bootstrap, `Model`, `MainView`, and the entire camera/
HaishinKit/SRS publish stack are **untouched**. Go Live is not a Flutter
route — tapping it invokes a bridge call that presents the existing native
`MainView` (unmodified) as a full-screen native cover over the Flutter view,
exactly mirroring how `.onChange(of: selectedTab)` already calls
`model.startCaptureStackIfNeeded()` today, just triggered from Dart instead
of a SwiftUI enum case.

This makes 5 existing files dead once the rewrite lands —
`BirqWebViewHolder.swift`, `BirqWebTabsController.swift`,
`BirqExploreView.swift`, `BirqWebSessionState.swift`,
`BirqSignInSheet.swift` — all specific to the WKWebView-tab architecture
Flutter replaces. They are removed in the same Phase 2 commit that replaces
their only caller (`RootTabView.swift`), with the crash-avoidance lessons
they encoded (never share one `WKWebView` across simultaneously-mounted
views; `delaysContentTouches = false`; a black/blank resting state must
never be reachable) carried forward as documented constraints even though
no code currently needs them (Flutter's screens are native Dart, and the
one remaining external-page need — Chapa checkout — uses
`SFSafariViewController`, not `WKWebView`, specifically to avoid needing any
of this machinery again).

### Channel

`MethodChannel("com.birq.mobile/flutter_consumer")`, registered on the
`FlutterViewController` at creation (Swift owns the channel; Flutter calls
into it).

| Direction | Method | Arguments | Return | Behavior |
| --- | --- | --- | --- | --- |
| Dart → Swift | `presentGoLive` | none | none (fire-and-forget) | Swift calls `model.startCaptureStackIfNeeded()` (idempotent, unchanged), then presents `MainView(...)` (same constructor args `RootTabView` already threads through) as a full-screen native cover over the `FlutterViewController`. |
| Swift → Dart | `onGoLiveDismissed` | none | — | Fired when the user backs out of the native Go Live view, so Flutter's own nav state restores to whichever tab was selected before Go Live (the Dart analogue of `lastAllowedTab`), same restore-prior-state behavior the AI rules doc requires. |

That is the entire contract. No method exists to read the native
broadcaster's `stream.birqLoggedIn`/token state from Dart, and none is
added — see § 4, item 2 (Storage) on why that separation is deliberate and
preserved, not an oversight.

### Embedding mechanism

No `Podfile`/`.xcworkspace` exists in `moblin-main` today (pure Swift
Package Manager, ~20 `XCRemoteSwiftPackageReference`s). Introducing
CocoaPods solely to embed one local Flutter module would be a structural
change to the whole project's dependency system for one feature — out of
proportion and explicitly against "keep changes scoped." Instead: `flutter
build ios-framework --output=Flutter/` inside `flutter_consumer/` produces
`Flutter.xcframework` + `App.xcframework` (+ any plugin xcframeworks, e.g.
`flutter_secure_storage`, `centrifuge_dart`'s platform channels if it has
native code) as prebuilt binary frameworks, embedded directly into
`Birq.xcodeproj` via "Frameworks, Libraries, and Embedded Content" — no new
workspace, no CocoaPods, consistent with the existing all-SPM setup. This
build step is documented as a required part of the native build
instructions from Phase 2 onward (`flutter build ios-framework` must be
re-run whenever `flutter_consumer`'s Dart/plugin surface changes, before
`xcodebuild` will pick up the new symbols).

Bundle ID `com.birq.mobile`, iOS deployment target 16.4 — `flutter_consumer`
targets the same floor.

## 6. Asset provenance audit

The Vercel archive's `public/` directory contains:

- `public/games/*.png` — stock cover art for Counter-Strike 2, Dota 2,
  League of Legends, World of Warcraft, Minecraft. **Not Birq-owned or
  licensed.** Since "Games" itself is being remapped to Birq's real category
  catalog (Music/Gaming/Traditional/Just Chatting, per
  `db/migrations/0046_content_categories.sql`), none of this specific
  artwork is needed — Birq's existing generated-gradient + letter-initial
  category art (`artworkUrl: null` fallback, already established in the web
  rebuild) is reused as-is for Flutter.
- `public/streams/*.png` (gaming-room, just-chatting, cs2-gameplay,
  irl-vertical) and `public/avatars/*.png` (streamer-1, user) — mock stream
  thumbnails / mock user avatars. **Not used.** Real thumbnails/avatars come
  from `liveStreamSchema.thumbnailUrl` / `creator.avatarUrl`, with a
  deterministic generated placeholder (matching the existing web
  `avatar-fallback.png` pattern) when null.
- `public/birq-logo.png`, `public/icon.svg`, `public/apple-icon.png` — this
  **is** Birq's own real wordmark/logo, safe and correct to reuse as the app
  icon / splash mark asset (it's the brand's own identity, not prototype
  filler).
- `public/placeholder*.{svg,png,jpg}` — generic shadcn/v0 scaffold
  placeholders, unrelated to Birq. Not used.

Font: Plus Jakarta Sans via `next/font/google`. Flutter will use the
`google_fonts` package (which fetches/embeds the same open-source Google
Fonts family, SIL Open Font License) rather than copying any font file out
of the archive — same real typeface, correctly licensed for redistribution
in an app bundle.

## 7. Migration assessment

No new database migration is required for the Flutter consumer app itself.
Every screen in the approved scope (Explore/Discover/Browse/Category/Watch/
Search/Following/Wallet/Profile/Activity) maps onto tables and API routes
that already exist (`content_categories`, `streams`, `follows`,
`notifications`, wallet ledger tables, `chat_messages`). Whispers/messaging
and a real Games domain are explicitly out of scope per the AI rules doc and
therefore need no schema work now. If the data-contract audit in § 3
surfaces a genuinely missing route (e.g., a client-facing notifications list
endpoint that turns out not to exist yet despite the schema being defined),
it will be logged here as a scoped, minimal addition — not a speculative
schema for deferred features.

## 8. Acceptance criteria and test plan

Per `docs/AI_RULES_BIRQ_FLUTTER_CONSUMER.md`'s completion criteria. Concrete
commands, run against local/test infrastructure only:

```bash
# Flutter (run from flutter_consumer/)
flutter format --set-exit-if-changed .
flutter analyze
flutter test                      # unit + widget
flutter test integration_test     # once integration_test scaffold exists

# Existing API (unchanged surface — regression check only)
npm run typecheck --workspace=apps/web
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api   # local Postgres only

# Native
xcodebuild -project Birq.xcodeproj -scheme Birq \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
# Objective-C exception breakpoint set in Xcode, then manual Simulator pass:
# first touch, scrolling, tab switches, Go Live handoff/return, signed-out
# interception → sign-in → destination, Profile → real settings (never
# creator /account).

git diff --check
```

Visual evidence required per shipped screen: screenshots at 390×844 and one
larger-device size, captured from a running Simulator build against real
(local, non-production) API data — not a static design comparison alone.
