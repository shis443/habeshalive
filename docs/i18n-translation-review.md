# i18n translation review — Oromo, Tigrinya, Somali

**Why this exists:** `messages/om.json`, `messages/ti.json`, `messages/so.json`
were filled in during this pass without a native-speaker review — same
"real code, honestly caveated" standard as the rest of this repo's docs,
applied to translation quality instead of code correctness. The mechanism
(locale selection, message loading, ICU interpolation) is verified for
real — see the commit's own testing notes — but *whether the Oromo,
Tigrinya, and Somali strings are actually correct, natural phrasing* is
not something an agent without a native speaker can verify, the same
category of gap `docs/rbac-and-moderation-testing.md` and
`docs/whep-rollout.md` already use this framing for (human-only checks).

## What's human-supplied vs. best-effort fill-in

**Directly supplied, use as given** — the following keys came from you,
verbatim, not translated by me:

| Key | Oromo | Tigrinya | Somali |
|---|---|---|---|
| `nav.search` | Barbaadi | ድለይ | Raadi |
| `nav.explore` | Sakatta'i | ዳህስስ | Sahami |
| `nav.following` | Hordofamaa jira | ትስዕቦም ዘለኻ | Waad la socotaa |
| `nav.goLive` | Dhiheessi | ብቐጥታ ጀምር | Qaddoo Bixiya |
| `nav.wallet` | Kusaa | ቦርሳ | Boorsada |
| `watch.offlineTitle` (core phrase) | Ammatti liiyii miti | ሕጂ ብቐጥታ ኣይኮነን ዘሎ | Hada ma live aha |
| `chat.welcome` (first sentence) | Baga gara chat dhuftan! | እንቋዕ ናብዛ ቻት ብደሓን መጻእኩም! | Kusoo dhawoow chat-ka! |
| `chat.placeholder` | Ergaa ergi... | መልእኽቲ ስደድ... | Dir xaqiiq... |
| `gursha.button` | Gurshaa | ጉርሻ | Gursha |
| `actionRow.giftASub` | Sub Kennaa | ሳብስክራይብ 💡 | Hadiya Sub |

Two of these look potentially off to me and are worth a specific
second look, not silently "corrected" on my own judgment: Somali
`nav.goLive` ("Qaddoo Bixiya") and `chat.placeholder` ("Dir xaqiiq") — my
own (uncertain) understanding is these read closer to "release/output
[something]" and "send the truth/fact" than "go live" / "send a message."
Flagging, not overriding — you may have gotten these from a source I
don't have visibility into.

**Everything else in om/ti/so** — the remaining ~38 of 48 keys per
language (the rest of `nav`, all of `moreGeneral`/`moreLegal`, the second
half of `chat.welcome`, `watch.offlineText`, `embed.offlineTitle`,
`gursha.button`'s Somali value which is left as the unmodified brand name)
— is my own best-effort fill-in. Reasonable confidence for Amharic
(closer working knowledge); materially less for Tigrinya specifically
(related but grammatically distinct from Amharic, and I leaned on
Ge'ez-script cognates more than direct knowledge in places); Oromo and
Somali fall in between.

## Before treating this as done

Get a native (or fluent) speaker to skim each of the three files —
they're short (48 short strings each) — before pointing real users at
them. This is genuinely different from every other "not yet verified"
item elsewhere in this repo's docs: those are things a human can
mechanically re-check (run the script, watch OBS, click the button).
Translation quality needs a different kind of check that a
non-speaker — human or AI — can't self-certify by testing harder.

## What's still English regardless of language selected

Only ~48 keys are wired to next-intl at all (`nav`, `moreGeneral`,
`moreLegal`, `watch`, `embed`, `chat`, `gursha`, `actionRow`) — this was
scoped to the nav/menu chrome (pre-existing) plus the specific
player/chat strings requested this pass, not the whole app. Still
hardcoded English regardless of locale: the `/settings` page's own labels
(`PreferencesSection.tsx` doesn't use `useTranslations` at all), every
other "Gursha" occurrence outside the one main action-button (the modal,
notification preferences, `/help` page — at least 7 more spots, see this
commit's own investigation), the "Subscribe" labels (both the per-creator
tier and the platform Birq+ one), all admin pages, all static pages
(`/about`, `/help`, `/community-guidelines`, etc.), and all wallet/gifting
flow copy beyond what's listed above. "Full translation coverage" (the
literal ask) is a substantially larger effort than this pass — TopNav's
settings note now says as much to users directly.
