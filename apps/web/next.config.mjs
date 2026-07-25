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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js's own inline bootstrap/hydration scripts need
              // 'unsafe-inline'; there's no nonce-based setup here.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: ${apiOrigin}`,
              `connect-src 'self' ${apiOrigin} ${srsOrigin} ${centrifugoOrigin}`,
              // hls.js plays back via MediaSource, which loads segments
              // through a blob: URL — default-src alone doesn't cover
              // blob:, so without this the <video> element's own playback
              // (not just the segment fetches above) is blocked too.
              "media-src 'self' blob:",
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
