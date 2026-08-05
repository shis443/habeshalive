# WHEP (WebRTC playback) rollout checklist

**Why this exists as a manual checklist, not automated:** real WebRTC/ICE/
DTLS/SRTP negotiation needs an actual browser talking to the actual
production `habeshalive-srs` machine over a real network — nothing an
agent without a browser or a deployed server can produce or verify. Code
review, typechecking, and the existing Vitest suite cover everything they
can (request validation, ban-teardown logic, the Redis session registry),
but none of that proves a real viewer's `RTCPeerConnection` actually
reaches `connected` and renders video. This is that missing verification,
to run before flipping the flags below in production.

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

## Before setting WHEP_ENABLED=true in production

1. **Deploy the SRS image rebuild first, alone, and verify existing WHIP
   publish + HLS playback both still work.** The Dockerfile/entrypoint/
   fly.toml changes here (new nginx proxy fronting the public port, new
   TCP WebRTC fallback listener) touch the exact port creators currently
   publish through — confirm a real OBS/browser WHIP publish still
   connects and viewers still see HLS before assuming the security fix is
   safe, using the same "check `/streams/live` is empty before restarting,
   verify via direct HTTP calls after" pattern as every other SRS deploy
   this project has done.
2. **Set `SRS_ADMIN_API_BASE` on the `habeshalive` (api) Fly app** to
   `http://habeshalive-srs.internal:1985` (Fly's private 6PN hostname —
   confirm the exact app name matches what `flyctl apps list` shows).
   Without this, the broker and ban-teardown fall back to
   `http://localhost:1985`, which doesn't exist on the api app's own
   machine — brokering will fail cleanly (502) rather than do anything
   unsafe, but WHEP simply won't work until this is set.
3. **Set `WHEP_ENABLED=true`** on the api app, but leave
   `NEXT_PUBLIC_WHEP_ENABLED` unset on the web app for now — this lets you
   exercise the broker route directly (e.g. `curl -X POST .../streams/<a
   real live stream id>/whep -d '{"offerSdp": "..."}'`) without any real
   viewer traffic attempting it yet.
4. **Set `NEXT_PUBLIC_WHEP_ENABLED=true` on a preview/staging Vercel
   deployment first, not directly on production.** Watch a real live
   stream end to end and confirm:
   - The player actually reaches `playing` via WHEP (check
     `RTCPeerConnection.getStats()` or just confirm sub-2s glass-to-glass
     latency vs. the ~6-12s HLS baseline in `docs/hls-latency-testing.md`).
   - Killing WiFi/switching networks mid-watch triggers the 3s-timeout or
     ICE-failed fallback to HLS cleanly (no stuck black screen).
   - A banned user's active WHEP session actually stops within a few
     seconds of the ban (test against a real throwaway account) — this
     exercises the ban-teardown path this environment couldn't verify.
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
  on this at all; it's a secondary, independent attempt only.
- **SRS's WHEP resource-URL `DELETE` handler itself** always returns 200
  whether or not it actually found a live session to expire (confirmed
  against SRS's own source, not assumed) — meaning a successful-looking
  teardown call is not proof the session actually ended. Real proof is
  step 4's live-ban test above.
