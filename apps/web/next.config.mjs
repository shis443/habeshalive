import path from "node:path";
import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// The browser talks to the API directly (not just via the /api/backend
// proxy) in a couple of places — LoginForm's request-otp call and
// AddFundsRow's dev-only simulate-payment call — and avatar images
// (lib/avatar.ts) are served from the API's origin too. Both need an
// explicit CSP allowance or they'd silently break; verified live with a
// real ZAP baseline scan both before (9 WARN findings, including this
// missing CSP header) and after this config was added (down to 2, both
// informational-only — see docs/architecture.md's Security scanning
// section for the full before/after).
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// hls.js fetches HLS segments via XHR/fetch (not a plain <video src>, so
// this is subject to connect-src, not just img/media-src) — found missing
// here while verifying real-time chat in a real browser: without this,
// segment requests are silently CSP-blocked in every non-Safari browser
// (confirmed via the actual browser console error, not assumed).
const srsOrigin = `${process.env.SRS_HTTP_SCHEME ?? "http"}://${process.env.SRS_HTTP_HOST ?? "localhost:8080"}`;

// Same discovery, same fix shape: the chat WebSocket connection to
// Centrifugo was also silently blocked. NEXT_PUBLIC_CENTRIFUGO_URL is the
// full ws(s)://.../connection/websocket path; CSP needs just the origin.
const centrifugoOrigin = new URL(
  process.env.NEXT_PUBLIC_CENTRIFUGO_URL ?? "ws://localhost:8000/connection/websocket"
).origin;

// Browser-based "go live" (WHIP): the signaling POST goes to a *different*
// port than srsOrigin above (SRS's http_api, not http_server — see
// infra/srs/fly.toml's comment on why WHIP needs its own exposed port).
// CSP host-sources without an explicit port only match the scheme's
// default port, so this needs the port spelled out or the fetch is
// silently blocked same as the other two were.
const srsWhipOrigin = new URL(
  process.env.NEXT_PUBLIC_SRS_WHIP_URL ?? "http://localhost:8443/rtc/v1/whip/"
).origin;

// VOD playback: empty until a real R2 bucket exists, so this contributes
// nothing to media-src yet. Since 2026-08-04, apps/api's VOD playback URLs
// are short-lived presigned R2 GetObject URLs (common/object-storage.ts's
// getSignedVodUrl) rather than a permanently public base URL — there's no
// more "VOD_S3_PUBLIC_URL" to mirror. NEXT_PUBLIC_VOD_PUBLIC_URL here
// should be set to the R2 endpoint's own origin (same host as apps/api's
// VOD_S3_ENDPOINT) — CSP only needs the origin, not a full object URL, so
// this doesn't leak anything a signed-URL scheme wouldn't already require.
// Found the hard way via a *different* bug (a stale API_PUBLIC_URL secret
// pointing stream thumbnails at localhost) that media-src silently blocks
// any origin not listed here — set this on Vercel the same day VOD_S3_*
// is set on Fly, or playback breaks with no visible error beyond the
// browser console.
const vodOrigin = process.env.NEXT_PUBLIC_VOD_PUBLIC_URL ? new URL(process.env.NEXT_PUBLIC_VOD_PUBLIC_URL).origin : "";

// Sentry's browser SDK reports errors via a fetch/XHR call to the DSN's own
// ingest host — without this in connect-src, that report is silently
// CSP-blocked, same failure shape as every other origin comment in this
// file. Empty (contributes nothing) until NEXT_PUBLIC_SENTRY_DSN is set.
const sentryOrigin = process.env.NEXT_PUBLIC_SENTRY_DSN ? new URL(process.env.NEXT_PUBLIC_SENTRY_DSN).origin : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js only inlines env vars actually named NEXT_PUBLIC_* into the
  // client bundle — VERCEL_GIT_COMMIT_SHA (Vercel's own build-time var) is
  // not one of those, so this re-exposes it under a name that is, giving
  // sentry.client.config.ts real release/version context instead of
  // silently evaluating to undefined in the browser.
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Excludes /embed/* (negative lookahead) — that route needs the
        // opposite frame-ancestors policy (see the dedicated block below).
        // CSP headers don't override when multiple match the same path —
        // browsers enforce the INTERSECTION of every CSP header sent, so a
        // permissive frame-ancestors on a more specific block would still
        // be cancelled out by 'none' here if both matched the same
        // request. They have to be mutually exclusive at the source level,
        // not layered.
        source: "/:path((?!embed).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // camera/microphone allowed for this origin only (needed for
          // browser-based "go live" via getUserMedia) — was previously
          // camera=(), microphone=() with no allowlist at all, which
          // silently blocks getUserMedia everywhere, before this feature
          // existed to need it.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js's own inline bootstrap/hydration scripts need
              // 'unsafe-inline'; there's no nonce-based setup here.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: ${apiOrigin}`,
              `connect-src 'self' ${apiOrigin} ${srsOrigin} ${centrifugoOrigin} ${srsWhipOrigin}${sentryOrigin ? ` ${sentryOrigin}` : ""}`,
              // hls.js plays back via MediaSource, which loads segments
              // through a blob: URL — default-src alone doesn't cover
              // blob:, so without this the <video> element's own playback
              // (not just the segment fetches above) is blocked too.
              //
              // srsOrigin also has to be listed here, separately from
              // connect-src above: Safari (both desktop and iOS) plays HLS
              // *natively* rather than via hls.js — VideoPlayer.tsx sets
              // video.src directly to the real manifest URL, which is a
              // media-src load, not a fetch/XHR one. Without this, that
              // direct load is CSP-blocked in Safari specifically while
              // every hls.js-based browser (Chrome, Firefox, Brave — all
              // of which go through connect-src instead) plays fine,
              // exactly matching a real report of "only works in one
              // Chromium browser." Confirmed live: WebKit's console showed
              // "Refused to load .../*.m3u8 because it does not appear in
              // the media-src directive," while the same URL loaded
              // successfully via fetch() in Chromium and Firefox.
              `media-src 'self' blob: ${srsOrigin}${vodOrigin ? ` ${vodOrigin}` : ""}`,
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              // object-src/base-uri/form-action don't fall back to
              // default-src per spec — ZAP's baseline scan flags leaving
              // them undefined ("Failure to Define Directive with No
              // Fallback"), and it's right to: an undefined form-action
              // would let an XSS bug redirect form submissions offsite.
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      {
        // D.3 embed target: the whole point is being framed on someone
        // else's page, so this is the deliberate opposite of the strict
        // block above — no X-Frame-Options, frame-ancestors * instead of
        // 'none'. Otherwise the same media/connect allowances the player
        // itself needs (hls.js + Safari's native HLS path — see the strict
        // block's comments for why both are listed).
        source: "/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: ${apiOrigin}`,
              `connect-src 'self' ${apiOrigin} ${srsOrigin} ${centrifugoOrigin} ${srsWhipOrigin}${sentryOrigin ? ` ${sentryOrigin}` : ""}`,
              `media-src 'self' blob: ${srsOrigin}${vodOrigin ? ` ${vodOrigin}` : ""}`,
              "font-src 'self' data:",
              "frame-ancestors *",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

// Wraps the build with Sentry's webpack plugin (source map generation +
// upload). Safe to leave active even without a real Sentry project: the
// plugin only attempts the actual upload when SENTRY_AUTH_TOKEN is set —
// otherwise it logs a warning and skips it rather than failing the build
// (verified against @sentry/nextjs's own docs, not assumed). org/project
// are undefined until a real Sentry project exists; the plugin tolerates
// that the same way.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
  // No server-side tunneling route through this app — not needed at
  // current scale, and it'd be one more thing to keep in sync with the
  // CSP's connect-src sentryOrigin allowance above.
  tunnelRoute: undefined,
});
