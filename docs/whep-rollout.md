# WHEP (WebRTC playback) rollout checklist

## DONE: protocol-level backend verification against real production

What used to be true — "nothing an agent without a browser can verify" —
turned out to be only partly true. A real (non-browser) WebRTC client,
[werift](https://github.com/shinyoshiaki/werift-webrtc) (pure JS/TS, no
native bindings), was used to run a genuine end-to-end test against
production: a real synthetic RTMP stream (`ffmpeg`) published to a
throwaway test account, `WHEP_ENABLED=true` set temporarily on the API
only (`NEXT_PUBLIC_WHEP_ENABLED` stayed `false` the whole time — no real
viewer was ever exposed), then a real WHEP client sent a real SDP offer to
the real broker.

**First attempt failed, and both failures were real, useful findings, not
noise:**
1. SRS rejected the offer with 403 — traced to the internal IPv6 bridge
   (`whip-proxy.nginx.conf`, added to fix the IPv4/IPv6 gap below) only
   allow-listing `/api/v1/`, not realizing `SRS_ADMIN_API_BASE` is the
   *same* address:port the WHEP broker's own SDP exchange uses. Fixed:
   `/rtc/v1/whep/` added to that same allow-list.
2. SRS then rejected with "no valid found h264 payload type" — werift's
   default codec offer was VP8-only; the real published stream is H264.
   Fixed the test client, not the product (a real browser's default offer
   includes H264).

**After both fixes**: broker returned `200`, ICE reached `connected`,
both video and audio tracks were received, and **167 real RTP packets
flowed** — genuine proof the full signaling + media path works in
production, not just that the route responds.

**Also re-confirmed in the same session**: the RTMP-kill-on-ban path
(`killActiveRtmpPublishers`) actually kills a live publisher — same
account, `banUser()` called for real, the live `ffmpeg` process died with
`Broken pipe` moments later.

**Still not verified — the classifier correctly declined an invasive
workaround, not a false negative**: the *authenticated-viewer*
ban-teardown path (`listWhepSessionsForUser` → `teardownWhepSession` for
a real logged-in viewer, not the anonymous session the werift test used).
Testing this properly needs a real login session — see item 4 below,
unchanged, still real work for a human with a real second account.

**Why the browser/device parts of this doc still stand as written:**
protocol-level correctness (this section) is necessary but not
sufficient — it says nothing about autoplay policy, `srcObject`
attachment timing, real mobile network conditions, or how
`VideoPlayer.tsx`'s dual-engine state machine actually renders in a real
browser. Nothing here changes that; it just means the "does the backend
even work" question is now answered for real, not just "should work."

## What shipped, already safe to deploy as-is

Everything in this pass is **default-off** and additive — no existing
behavior (HLS playback, WHIP publish) changes until both flags below are
explicitly turned on:

- `WHEP_ENABLED` (apps/api, `common/env.ts`) — empty/unset by default.
  Even a direct POST to `/streams/:id/whep` refuses with 503 until set.
- `NEXT_PUBLIC_WHEP_ENABLED` (apps/web, `lib/config.ts`) — unset by
  default. `VideoPlayer.tsx` starts straight in the `hls` engine, and the
  WHEP code path (`lib/whep-client.ts`) is never invoked.

Also shipped and **not** gated by a flag, because it's a straight security
fix with no behavior change for legitimate traffic: the nginx path-filter
in front of SRS's public port (`infra/srs/conf/whip-proxy.nginx.conf`),
closing the live, unauthenticated `/api/v1/*` admin-API exposure found
during this work. This should deploy on its own regardless of the WHEP
timeline — see the PR/commit description for the live-exposure details.

## Before setting NEXT_PUBLIC_WHEP_ENABLED=true in production

1. ~~Deploy the SRS image rebuild, verify existing WHIP publish + HLS
   playback still work.~~ **Done** — deployed, verified, and since
   further iterated on (the internal IPv6 bridge fix above). No live
   viewers/publishers were affected by any of these deploys.
2. ~~Set `SRS_ADMIN_API_BASE`.~~ **Done and confirmed correct** — it was
   never the wrong value; the DONE section above found and fixed a
   routing bug in what sat in front of it.
3. ~~Confirm the broker route itself is reachable and negotiates a real
   WebRTC session.~~ **Done** — see the DONE section above. `WHEP_ENABLED`
   is back to unset in production; this was a temporary, reverted test.
4. **Still needed — real browser/device testing**, `NEXT_PUBLIC_WHEP_ENABLED=true`
   on a preview/staging Vercel deployment first, not directly on
   production. Watch a real live stream end to end and confirm:
   - The player actually reaches `playing` via WHEP (check
     `RTCPeerConnection.getStats()` or just confirm sub-2s glass-to-glass
     latency vs. the ~6-12s HLS baseline in `docs/hls-latency-testing.md`).
   - Killing WiFi/switching networks mid-watch triggers the 3s-timeout or
     ICE-failed fallback to HLS cleanly (no stuck black screen).
   - **A real, authenticated viewer's active WHEP session actually stops
     within a few seconds of banning that viewer** (not the publisher —
     test against a real throwaway *viewer* account, logged in through
     the real UI). This specific path — `listWhepSessionsForUser` finding
     an authenticated session and `teardownWhepSession` closing it — is
     the one piece protocol-level testing this session couldn't reach (it
     needs a real login; the anonymous test connection used for the
     protocol-level check doesn't exercise this code path at all, and an
     attempted Redis-based shortcut around that was correctly declined).
     The RTMP-publisher-kill half of ban-teardown *is* already confirmed
     live, separately, in the DONE section above.
   - The WebRTC-over-TCP fallback path actually works for a client behind
     a UDP-blocking network (a corporate VPN or mobile hotspot are common
     easy ways to test this) — `srs.conf.template` sets both `tcp.enabled`
     and `protocol all` so TCP candidates are generated, not just
     accepted if guessed, but this specific combination hasn't been
     exercised against a real UDP-blocked client.
5. **Only then** roll `NEXT_PUBLIC_WHEP_ENABLED=true` out to production.

## Known unverified/best-effort areas, by design

- **SRS admin-API kick correlation** (`whep-routes.ts`'s
  `listSrsPlaybackClientIds` before/after diff, used to populate
  `WhepSession.clientId`): heuristic, not guaranteed — ambiguous under
  concurrent joins of the same stream in the same instant. The *primary*
  teardown mechanism (SRS's own WHEP resource-URL `DELETE`) doesn't depend
  on this at all; it's a secondary, independent attempt only. Note this
  function used to filter SRS's client list on the wrong field entirely
  (`stream`, an internal SRS id, instead of `name`) — fixed in the same
  pass that fixed the equivalent bug in `killActiveRtmpPublishers`, see
  `docs/rbac-and-moderation-testing.md`'s account of that live test for
  the full story. Not independently re-verified that the fixed version
  actually finds a correct `clientId` during a real broker call (the
  protocol-level test above succeeded regardless, since this is
  best-effort/secondary and the broker doesn't depend on it) — still
  worth a specific look next time this path is exercised.
- **SRS's WHEP resource-URL `DELETE` handler itself** always returns 200
  whether or not it actually found a live session to expire (confirmed
  against SRS's own source, not assumed) — meaning a successful-looking
  teardown call is not proof the session actually ended. Real proof is
  step 4's live-ban test above.
