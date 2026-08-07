import { NextResponse, type NextRequest } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { getSessionToken } from "@/lib/session";

// A thin authenticated proxy: client components can't read the httpOnly
// session cookie, so mutations (go-live, rotate key, top-ups, payouts) route
// through here, which attaches the JWT server-side before forwarding.
// Runs server-side, so it needs API_INTERNAL_URL (see config.ts) — not the
// browser-facing API_BASE_URL.
//
// Forwards without an Authorization header (rather than hard-401ing) when
// there's no session — the backend route itself decides whether that's
// fine: app.authenticate rejects with its own 401 (same shape this used to
// fabricate locally, so no behavior change for any of the existing
// mutation-only callers below), app.tryAuthenticate proceeds anonymously.
// Needed for streams/whep-routes.ts's POST/DELETE :id/whep — a client
// component (VideoPlayer.tsx) has no other way to reach an
// authenticate-when-present-but-not-required backend route, since it can't
// read the httpOnly cookie itself to call apps/api directly the way
// anonymous-friendly Server Component reads (getLiveStreamByUsername etc.)
// do.
async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const token = await getSessionToken();

  // req.nextUrl.search carries the leading "?" (empty string when there's
  // no query at all) — appending it directly is correct either way.
  // Missing this dropped every query param a client-side GET sent through
  // here (e.g. the ledger lookup's ?q=...), confirmed live: the backend
  // received a bare path and silently matched nothing.
  const targetUrl = `${API_INTERNAL_URL}/${path.join("/")}${req.nextUrl.search}`;
  const canHaveBody = req.method !== "GET" && req.method !== "HEAD";
  // ArrayBuffer, not text() — this proxy now also carries binary
  // multipart/form-data bodies (kyc/routes.ts's file upload), and text()
  // would corrupt non-UTF8 bytes (a JPEG/PNG/PDF) by round-tripping them
  // through string decoding. An empty ArrayBuffer is truthy (unlike ""),
  // hence the explicit byteLength check below rather than `body || undefined`.
  const body = canHaveBody ? await req.arrayBuffer() : undefined;
  const hasBody = body !== undefined && body.byteLength > 0;

  const res = await fetch(targetUrl, {
    method: req.method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Forwards the real Content-Type (application/json, or
      // multipart/form-data; boundary=... for a file upload) rather than
      // hardcoding application/json — a multipart body needs its boundary
      // parameter to parse at all. Only set when there's a body at all:
      // Fastify's JSON parser rejects an empty body sent with this header
      // (e.g. a bodyless POST like key rotation).
      ...(hasBody && req.headers.get("content-type")
        ? { "Content-Type": req.headers.get("content-type")! }
        : {}),
    },
    body: hasBody ? body : undefined,
    cache: "no-store",
  });

  const data = await res.text();
  return new NextResponse(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
