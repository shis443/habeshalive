# Flutter reference — literal rebuild audit

Supersedes `docs/TWITCH_REFERENCE_FEATURE_AUDIT.md`'s conclusion. Direction,
confirmed explicitly by the user: **the Flutter reference
(`fluttership/Twitch-Clone-Flutter`, checked out at
`/Users/adem/Downloads/Twitch-Clone-Flutter-master`) is the literal
UI/UX specification** — screen structure, information hierarchy, visual
density, component variants, navigation flow, spacing, and motion — not
loose inspiration. Only the glass bottom nav is protected.

Legal boundary (unchanged): no Dart source, no Twitch branding/logos/sample
users/remote image URLs/reference fonts. Every number below is a structural
spec (px, weight, radius) to recreate natively with Birq's own licensed
fonts, tokens, and real data — never literal asset reuse.

## Exact specs extracted from source (file:line cited)

### Global chrome (`lib/main.dart`)
- `AppBar(elevation: 0.0)` (line 99) — flat, no shadow/blur.
- Leading avatar: `EdgeInsets.all(8.0)` padding, 19×19 box, `borderRadius: 45.0` (fully round) (lines 54-59).
- 4 action `IconButton`s, Material defaults (24px icon, 48×48 min tap target, 8px padding) — no custom spacing coded (lines 46-49, 101-106).
- No AppBar title is ever set — `AppBarTheme.textTheme.title` (18px/w800) exists in `constants.dart` but is unused.

### Page titles (Following/Discover/Browse)
- `fontSize: 40.0, fontWeight: FontWeight.bold` — identical across all three (following.dart:48-49, discover.dart:25-26, browse.dart:30-31).
- Left padding: Following/Discover use container-level `left: 15.0`; Browse uses `left: 20.0` directly on the title padding. Top padding `15.0` on all three.

### Section labels
- "LIVE CHANNELS"/"OFFLINE CHANNELS" (following.dart:54-64) and "RECOMENDED LIVE CHANNELS" (discover.dart:96-99): plain text, **no explicit fontSize/weight/letter-spacing/color** — inherits theme body style. `vertical: 20.0` padding (Following) / `top:25, bottom:10` (Discover header).
- "RECOMMENDED CATEGORIES" (discover.dart:34-45): same — no explicit size, second word colored `twitchMainColor` (`rgba(100,65,164,1)`, Birq's own `--primary` is the natural token match, not a literal port of this exact ARGB value).

### Tabs (Browse + Category detail — identical styling)
- `labelColor`/`indicatorColor`: `twitchMainColor`. `unselectedLabelColor`: theme-dependent black/white.
- `indicatorSize: TabBarIndicatorSize.label` — underline is only as wide as the label text, **not the full tab width** (a real, specific deviation from Birq's current full-width/pill tabs).
- No explicit label fontSize/indicator thickness — Material default (2.0 weight).
- Browse tab order: **Categories, then Live Channels**. Category-detail tab order: **Live Channels, Videos, Clips**.

### Category detail header (`categories.dart`)
- Cover image: 100×140, `borderRadius: 5.0`, `EdgeInsets.all(15.0)` padding (lines 44-59).
- Info column: `height: 155.0`, vertically centered relative to the 140px image (lines 64-66).
- Category name: `fontSize: 25.0`, ellipsis overflow (lines 74-78).
- Stat row: number `bold, 15.0`; label (" Viewers"/" Followers") `15.0, grey[600]`, `5.0` gap between the two stat blocks (lines 80-108).
- Tag row: `top: 6.0` padding, `height: 20.0` (lines 117-133).
- Header layout: image left, info column right, `Row` with `crossAxisAlignment: start` (line 149).
- This screen's own AppBar has only cast + favorite_border — **both dead in the reference** (no real cast/favorite target exists in Birq either — see functional section below).

### Live cards — three real, distinct densities
| | Large | Medium | Small |
|---|---|---|---|
| Thumbnail | full-width, ~screen-height/4 tall (no fixed AR coded) | same as large | **fixed 120×70** (AR ~1.71:1) |
| Card width | full-width | **fixed 370** | full-width row |
| Avatar | 50×50 | 40×40 | 20×20 |
| LIVE badge | `top/left:6`, radius 4, pad `1v/4h` | identical to large | red dot 10×10 + viewer text, `bottom/left:3` |
| Viewer pill | `bottom/left:6`, radius 5, pad `2v/6h`, dark-gradient bg | identical to large | inline with live dot, `bold 13px white` |
| Title/desc/game | name (no size) / desc 13px / game 12px grey[700] | identical to large | username 16px / desc 16px / game 13px grey[700] |
| Layout | `Column` (image stacked over info) | `Column`, fixed 370w | `Row` (thumbnail left, info right) |

Web translation: the large/medium tiles' viewport-relative thumbnail height
has no direct responsive-web equivalent (a fixed-vh box doesn't make sense
in a scrolling page) — using `aspect-ratio: 16/9` for `LiveCardLarge`/
`LiveCardMedium` is the sensible engineering translation, not a literal
port, and matches Birq's existing HLS player convention. The small
tile's **fixed 120×70 px** is portable as-is.

### Channel row (`channel_tile_medium.dart` — filename is misleading; the actual class is `ChannelTileSmall`)
- Built on a plain list-row pattern (Material `ListTile` in the reference), 40×40 avatar, title 16px, subtitle ("N new video(s)") 13px grey[700], 10×10 grey[400] dot trailing **only when `newVideos > 0`**.

### Category tiles
| | Medium (Discover rail) | Small (Browse list) |
|---|---|---|
| Image | **130×185** | **50×80** |
| Layout | `Column` (image top, info below) | `Row` (image left, info right) |
| Name | 14px, single-line fade | no explicit size, fade overflow |
| Views | 12px, no color override | 14px, grey[700] |
| Tag row | `top:6`, `height:20` | `top:5`, `height:20` |

This is the direct fix for the "giant M card" complaint: Browse's Categories
tab must be the **small tile's compact row** (50×80 image + name + real
viewer count + tags, left-aligned row), not a large gradient card.

### VOD card (`video_tile_medium.dart`)
Three overlay badges, all `radius:5`, dark-gradient bg, pad `2v/6h`:
duration `top-left`, views `bottom-left`, relative-date `bottom-right`
("N days ago"). Fixed 370px card width, avatar 40×40, same text hierarchy
as the medium live tile (desc 13px / game 12px grey[700]).

### Clip card (`clip_tile_large.dart`)
- Top row: avatar 50×50 + name(16px)/date(14px grey[700])/category(14px grey[700]) left; favorite-heart + overflow-menu icons right — **both dead in the reference, no backing feature in Birq either** (see functional section).
- Media: viewport-relative height, **plain positioned text overlays for views/duration (no badge background)** — a real, deliberate visual difference from the other tiles' badge style.
- Description 16px.
- Two near-half-width buttons ("Watch full video", "Share") — **"Watch full video" is redundant/dead in the reference** since the card itself has no separate tap-through already; **"Share" is dead** (`onPressed: () {}`). Birq's version keeps the card's own tap-through and makes Share real (Web Share API + copy-link to the existing `/clip/[id]` URL) rather than cloning either dead button.

### Tag chip (`text_tag.dart`)
`borderRadius: 15.0` (pill), bg `grey[800]`/`grey[300]` by theme (no
per-instance color param — always the same two-tone treatment), padding
`horizontal:10` only (no vertical — height comes from text line-height),
text `12px`, `right:5` gap between chips in a row.

### No shared type-scale exists in the reference
Confirmed via full directory listing: no `lib/theme` or `lib/styles` dir.
`lib/utils/constants.dart` defines only colors (`twitchMainColor =
rgb(100,65,164)`, a purple Birq's own `--primary` already covers) plus one
unused AppBar title style. **Every font size above is hardcoded per
component** — there is no "title:32/section:14/body:14/caption:12" scale to
port. Birq's rebuild introduces its own real type-scale (below) rather than
inventing one to match a pattern that doesn't exist in the source.

## Non-functional controls confirmed dead in the reference (do not clone as-is)

- Global AppBar: cast, notifications-icon (Birq's real bell replaces it), comment/DM icon, search-icon (Birq's real search replaces it) — cast and comment/DM have **no onPressed at all**.
- Category-detail AppBar: cast, favorite_border.
- Every live/video card's own tap (Birq's cards already navigate — keep that, it's strictly better).
- Clip card: favorite-heart, overflow-menu, "Watch full video" (redundant), "Share" (`() {}`).

## Real backend/data work this rebuild requires

| Feature | Status before this work | Real slice built |
|---|---|---|
| Category catalog (name, description, tags, sort order, active flag) | `STREAM_CATEGORIES` was a flat 4-string array, no metadata | `content_categories` + `category_tags` tables (migration 0046), public `GET /categories` / `GET /categories/:slug`, admin CRUD |
| Category live-viewer / follower stats | Follower count already real (`category-service.ts`); viewer count computed ad hoc per page | Centralized into the category service response |
| Offline "new videos" count | Boolean `hasNewContent` | Real integer count (VODs + clips since last visit), not a boolean — Following rebuild |
| Clip share | No share control existed | Web Share API + copy-link fallback to the real `/clip/[id]` URL — no DB write needed |
| Cast | No transport | **Not built** — no Chromecast/AirPlay SDK integrated anywhere in this app. Control hidden, not faked. Documented as a real, separate, larger integration if ever prioritized. |
| Global comment/DM icon | No inbox/thread system exists anywhere in the schema | **Not built in this pass** — a real DM system (threads, messages, blocking/authorization, real-time delivery via Centrifugo, notifications, UI) is a full vertical slice on the scale of the chat system itself, not a rebuild-phase side task. Hidden for now; flagged as a distinct, large, separately-scoped feature requiring its own planning pass, same reasoning as the cast control. |

## Component primitives introduced

`ReferenceAppBar`, `UnderlineTabs`, `SectionLabel`, `LiveCardLarge`,
`LiveCardMedium`, `LiveRowCompact`, `FollowingOfflineRow`,
`CategoryRailCard`, `CategoryRowCompact`, `CategoryHero`, `VodCardReference`,
`ClipFeedCard`, `MetadataChip`, `MediaStatusOverlay` — each consumes typed
Birq data only (`@birq/shared` types), no mock arrays.

## Protected: bottom navigation

Native iOS: confirmed 5 real tabs in `RootTabView.swift` — Explore,
Following, Go Live (center), Wallet, Profile. Web: `BottomNavClient.tsx`'s
4 tabs (Explore, Following, Go Live, Wallet — Profile lives under the
account menu on web, not a 5th tab there). Neither changes. Mapping the
reference's 3-tab bar onto Birq's real nav: Explore → Flutter-style
Discover, Following → Flutter-style Following, Browse → a real reachable
route from Discover/the header (not a bottom-nav tab, matching Birq's
existing IA where Browse is already one link away from Explore).
