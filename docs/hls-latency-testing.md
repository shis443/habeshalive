# HLS latency testing checklist

**Why this exists as a manual checklist, not automated:** measuring
glass-to-glass (camera-to-screen) latency and real playback buffering
needs an actual OBS broadcast and real browsers/devices — nothing an
agent without a camera, OBS, or a phone can produce. This is a guide for
a human (you, or whoever's available) to run.

**What changed, already deployed to production** (2026-08-04):
`infra/srs/conf/srs.conf.template` — `hls_fragment` 4s→2s, `hls_window`
30s→10s. Verified live: `habeshalive-srs` Fly app redeployed and healthy,
no stream was interrupted (checked `/streams/live` was empty before
restarting).

**What changed, already deployed to production** (2026-08-05 — shipped
bundled into the WHEP commit `a9e7784` since that same refactor touched
this file; not its own deploy, but live regardless):
`apps/web/components/VideoPlayer.tsx`'s hls.js config —
`liveSyncDurationCount` 2→1, `maxBufferLength` capped to 10s (was
unset/default 30s), `enableWorker: true`, `maxLiveSyncPlaybackRate: 1.2`
(auto-speeds-up playback to catch up when behind the live edge).
`lowLatencyMode: true` is also set but confirmed inert — this SRS version
has no `#EXT-X-PART`/partial-segment support (checked the actual server
source, not assumed), so true LL-HLS isn't achievable on this stack
regardless of player config. **Unlike the `hls_fragment`/`liveSyncDurationCount:
2` change above, none of this new batch has been measured against a real
stream yet** — the `liveSyncDurationCount: 1` and `maxBufferLength: 10`
values specifically trade rebuffer risk for latency and could make
playback worse on a rough connection; verify rebuffer count (§2's table)
before treating them as a clean win.

This checklist verifies the effect of both batches, neither of which has
been measured yet.

## 1. Set OBS's keyframe interval to 2s first

The BIRQ guidelines specifically call this out, and it matters for a
concrete reason: HLS can't cut a segment mid-GOP (group of pictures) —
SRS's `hls_fragment 2` is a *target*, not a hard cap, and it rounds up to
the next keyframe. If OBS is still sending keyframes every 4s (its
default) or less often, segments will still come out ~4s+ regardless of
the SRS config change, silently defeating the point of this whole change.

- OBS → Settings → Output → (Advanced mode) → Keyframe Interval → **2**.
- Confirm in OBS's own stats/log that segments are landing near 2s, not
  just trusting the setting took effect.

## 2. What to measure

| Metric | How |
|---|---|
| **Glass-to-glass latency** | Point a phone camera at a millisecond-precision clock (e.g. [time.is](https://time.is) fullscreen) as the OBS source. Play the resulting stream on a viewer device sitting next to that same clock. Photograph or screen-record both the physical clock and the viewer's screen in the same frame — the visible time difference is your latency. (Simplest rig: laptop showing time.is is the "camera subject," phone plays the stream next to the laptop screen, one photo captures both.) |
| **Time to first frame** | Stopwatch from clicking "watch" to first visible video frame. |
| **Rebuffer count** | Watch 5 continuous minutes per browser/device, count visible stalls/spinner appearances. |
| **Recovery after a network hiccup** | Toggle wifi off for ~3s mid-playback, confirm it resumes smoothly rather than erroring or getting stuck — the smaller `hls_window` (10s, was 30s) means less backlog buffer is available server-side for a lagging client to catch up from, worth specifically checking this didn't get worse. |
| **New-viewer join latency** | Open the stream fresh (not already watching) — confirm it starts near-live, not noticeably behind. |

## 3. What to test on (this codebase has two real, different playback paths — test both)

Per `docs/architecture.md`'s Video pipeline section and
`next.config.mjs`'s CSP comments: `VideoPlayer.tsx` uses **hls.js** on most
browsers but falls back to **native HLS** on Safari (desktop and iOS) —
these are genuinely different code paths that have broken independently of
each other before in this project (see that CSP file's own comment about a
Safari-only bug found this way). Test at minimum:

- [ ] Chrome desktop (hls.js path)
- [ ] Safari desktop (native HLS path)
- [ ] Safari iOS (native HLS path, mobile — different buffering behavior
      than desktop Safari is common)
- [ ] Chrome Android (hls.js path, mobile)

## 4. What to expect, roughly

Not a guarantee — general HLS behavior, not measured against this specific
deployment: most HLS players buffer several segments ahead for stability
before starting playback (commonly ~3 segments), so with 2s fragments,
glass-to-glass latency in roughly the **6–12 second range** would be a
normal outcome, not a bug — this config change alone can't get you below
~3× the fragment duration no matter how it's tuned, because that's
inherent to segmented HLS, not this app's specific settings. If you need
consistently under ~5s, that's what the BIRQ guidelines' "WHEP/WebRTC
playback later" note is for — a fundamentally different delivery
mechanism, not a further HLS tuning knob. Not attempted in this pass.

## 5. Record results here (fill in after testing)

| Device/Browser | Time to first frame | Glass-to-glass latency | Rebuffers/5min | Notes |
|---|---|---|---|---|
| Chrome desktop | | | | |
| Safari desktop | | | | |
| Safari iOS | | | | |
| Chrome Android | | | | |
