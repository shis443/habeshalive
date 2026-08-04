// HLS viewer-session token gate + manifest rewriter for stream.birq.live.
// See docs/egress-protection-plan.md (§3) for the full design rationale.
// Not deployed and not run against a live Cloudflare zone in the session
// this was written in — verify against Stage 1/2 of that doc's rollout
// plan before trusting this as the sole control on real traffic.
//
// Token format: apps/api/src/streams/hls-token.ts's hand-rolled HS256
// scheme (header.payload.signature, base64url) — the same shared secret
// (HLS_TOKEN_HMAC_SECRET) must be set as a Worker secret
// (`wrangler secret put HLS_TOKEN_HMAC_SECRET`) and as apps/api's Fly
// secret of the same name, or every token this Worker sees will fail
// verification.

export interface Env {
  HLS_TOKEN_HMAC_SECRET: string;
}

function base64urlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface TokenPayload {
  streamId?: string;
  exp?: number;
}

async function verifyToken(token: string, secret: string, expectedStreamId: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(encodedPayload))) as TokenPayload;
  } catch {
    return false;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return false;
  if (payload.streamId !== expectedStreamId) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signatureBytes = base64urlToBytes(encodedSignature);
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  return crypto.subtle.verify("HMAC", key, signatureBytes, data.buffer as ArrayBuffer);
}

// Matches SRS's default HLS naming (no custom hls_fragment_name
// configured — see infra/srs/conf/srs.conf.template): manifests are
// exactly `<stream>.m3u8`, segments are `<stream>-<seq>.ts`. Branching on
// extension first, not stripping a trailing "-<digits>" from a single
// combined regex, matters here specifically because stream ids are
// creator UUIDs (streams/video-provider.ts's getPlaybackUrl uses the
// creator's userId) — a UUID's last hyphen-segment is occasionally
// all-decimal by chance, which a naive "strip trailing -\d+" applied to
// manifest filenames too could misparse. Manifests never have a -<seq>
// suffix at all, so they're never subject to that ambiguity; segments
// require the suffix as part of the match, with greedy (.+) correctly
// finding the rightmost valid split even when the id itself ends in
// digits after a hyphen.
function extractStreamId(pathname: string): string | null {
  const manifestMatch = pathname.match(/^\/live\/(.+)\.m3u8$/);
  if (manifestMatch) return manifestMatch[1]!;
  const segmentMatch = pathname.match(/^\/live\/(.+)-\d+\.ts$/);
  return segmentMatch ? segmentMatch[1]! : null;
}

function appendToken(url: string, token: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${token}`;
}

// Rewrites every segment URI line in the manifest to carry the same
// validated token. This — not relying on the player to propagate a query
// string itself — is the load-bearing design choice: it has to work
// identically for hls.js and Safari's native HLS engine, which have no
// shared hook for attaching a token to each derived request (see
// docs/egress-protection-plan.md §3 for why that alternative was
// rejected).
function rewriteManifest(body: string, token: string): string {
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return appendToken(line, token);
    })
    .join("\n");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const streamId = extractStreamId(url.pathname);

    if (!streamId) {
      // Anything under /live/* that doesn't match the expected manifest/
      // segment filename shape (e.g. SRS's crossdomain.xml) — pass
      // through unauthenticated, same as before this Worker existed.
      // Nothing sensitive lives there.
      return fetch(request);
    }

    const token = url.searchParams.get("t");
    if (!token || !env.HLS_TOKEN_HMAC_SECRET || !(await verifyToken(token, env.HLS_TOKEN_HMAC_SECRET, streamId))) {
      return new Response("Forbidden", { status: 403 });
    }

    const originResponse = await fetch(request);

    if (url.pathname.endsWith(".m3u8")) {
      const body = await originResponse.text();
      const headers = new Headers(originResponse.headers);
      headers.set("content-type", "application/vnd.apple.mpegurl");
      // Manifests carry a per-viewer token — must never be cached at the
      // edge or in the browser (docs/egress-protection-plan.md §6),
      // unlike segments below, which stay cacheable per docs/cdn.md's
      // existing Cache Rules.
      headers.set("cache-control", "no-store");
      return new Response(rewriteManifest(body, token), { status: originResponse.status, headers });
    }

    // Segments: pass through unchanged so Cloudflare's Cache Rules can
    // still cache them — rewriting or buffering the body here would
    // defeat that.
    return originResponse;
  },
};
