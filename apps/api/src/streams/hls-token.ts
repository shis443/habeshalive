import { createHmac } from "node:crypto";
import { env } from "../common/env.js";

// Same hand-rolled HS256 pattern as chat/token.ts's signHs256 — no JWT
// library needed for something this small. Unlike chat's token (verified
// by this API itself via Centrifugo), this one is verified by a
// Cloudflare Worker (docs/egress-protection-plan.md), so the format needs
// to be something the Worker can check with nothing but Web Crypto's
// HMAC support — plain header.payload.signature, base64url-encoded, is
// portable to both sides without either needing a JWT library.
function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: Record<string, unknown>): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", env.HLS_TOKEN_HMAC_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export const isHlsTokenConfigured = Boolean(env.HLS_TOKEN_HMAC_SECRET);

// Long enough to cover a full viewing session given VideoPlayer.tsx
// fetches playbackUrl once per page load with no refresh mechanism (same
// constraint documented for VOD's getSignedVodUrl) — matching VOD's 6h
// TTL for consistency, short enough to bound a leaked manifest URL's
// usefulness instead of it working forever.
const HLS_TOKEN_TTL_SECONDS = 6 * 60 * 60;

// Appends a short-lived signed token to a manifest URL. No-op (returns
// the URL unchanged) until HLS_TOKEN_HMAC_SECRET is configured — safe to
// call unconditionally from anywhere a playback URL is composed for a
// viewer, ahead of the Cloudflare Worker that will actually enforce it:
// SRS's static file server ignores unknown query params, so appending
// `?t=...` to a URL nothing validates yet is harmless, not broken.
//
// streamId is the same identifier already used in the URL path (the
// creator's userId — see streams/video-provider.ts's getPlaybackUrl and
// composeStreamKeyField's comment for why), not the internal DB row id —
// binding the token to it lets the Worker cross-check "does this token
// match the stream actually being requested," not just "is this
// signature valid for something."
export function appendHlsToken(playbackUrl: string, streamId: string): string {
  if (!isHlsTokenConfigured) return playbackUrl;
  const token = sign({ streamId, exp: Math.floor(Date.now() / 1000) + HLS_TOKEN_TTL_SECONDS });
  const separator = playbackUrl.includes("?") ? "&" : "?";
  return `${playbackUrl}${separator}t=${token}`;
}
