import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// VOD playback (Section 4 — see apps/api's VOD_S3_PUBLIC_URL): empty until
// a real R2 bucket exists, so this contributes nothing to media-src yet.
// Found the hard way via a *different* bug (a stale API_PUBLIC_URL secret
// pointing stream thumbnails at localhost) that media-src silently blocks
// any origin not listed here — set NEXT_PUBLIC_VOD_PUBLIC_URL on Vercel
// the same day VOD_S3_PUBLIC_URL is set on Fly, or playback breaks with
// no visible error beyond the browser console.
const vodOrigin = process.env.NEXT_PUBLIC_VOD_PUBLIC_URL ? new URL(process.env.NEXT_PUBLIC_VOD_PUBLIC_URL).origin : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
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
              `connect-src 'self' ${apiOrigin} ${srsOrigin} ${centrifugoOrigin} ${srsWhipOrigin}`,
              // hls.js plays back via MediaSource, which loads segments
              // through a blob: URL — default-src alone doesn't cover
              // blob:, so without this the <video> element's own playback
              // (not just the segment fetches above) is blocked too.
              `media-src 'self' blob:${vodOrigin ? ` ${vodOrigin}` : ""}`,
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
    ];
  },
};

export default nextConfig;
