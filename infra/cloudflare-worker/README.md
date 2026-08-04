# HLS viewer-token gate (Cloudflare Worker)

**Status: written, not deployed.** No `wrangler deploy` has been run
against a real Cloudflare account in the session this was written in.
Full design rationale: `docs/egress-protection-plan.md` (§3-4).

## What this does

Sits in front of `stream.birq.live/live/*` (once the DNS/Tunnel setup in
`docs/egress-protection-plan.md` §1-2 exists) and:

1. Rejects any manifest/segment request with a missing, expired, or
   invalid `?t=` token before it reaches the SRS origin.
2. For manifest (`.m3u8`) requests: fetches from origin, rewrites every
   segment line to carry the same validated token, and forces
   `cache-control: no-store` (a manifest is per-viewer now, must never be
   cached).
3. For segment (`.ts`) requests: passes through unchanged so Cloudflare's
   existing Cache Rules (`docs/cdn.md`) still apply.

The token itself is minted by `apps/api/src/streams/hls-token.ts` and
already gets appended to every playback URL the API returns — that part
is live in the code today (safe no-op until `HLS_TOKEN_HMAC_SECRET` is
set, since SRS ignores the extra query param). This Worker is the other
half: the thing that actually enforces it.

## Deploy steps (once you have Cloudflare access set up)

```sh
cd infra/cloudflare-worker
npm install
wrangler login
npm run secret:set   # paste the same value as apps/api's HLS_TOKEN_HMAC_SECRET Fly secret
npm run deploy
```

Then set `HLS_TOKEN_HMAC_SECRET` as an `apps/api` Fly secret too (must be
the *same* value on both sides), and set up the DNS/Tunnel routing this
Worker's route pattern depends on — see
`docs/egress-protection-plan.md` §1-2 for that part; this directory only
covers the Worker itself, not origin lockdown.

## Verify before trusting this on real traffic

Follow `docs/egress-protection-plan.md`'s Staging test plan (§8) —
particularly: a tampered/expired token gets `403` on both manifest and
segment requests, a valid token plays a real stream end-to-end through
both `hls.js` and Safari's native HLS path, and `cf-cache-status`
confirms segments cache while manifests don't.
