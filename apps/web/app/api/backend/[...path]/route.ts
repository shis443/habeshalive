import { NextResponse, type NextRequest } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { getSessionToken } from "@/lib/session";

// A thin authenticated proxy: client components can't read the httpOnly
// session cookie, so mutations (go-live, rotate key, top-ups, payouts) route
// through here, which attaches the JWT server-side before forwarding.
// Runs server-side, so it needs API_INTERNAL_URL (see config.ts) — not the
// browser-facing API_BASE_URL.
async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const targetUrl = `${API_INTERNAL_URL}/${path.join("/")}`;
  const canHaveBody = req.method !== "GET" && req.method !== "HEAD";
  const body = canHaveBody ? await req.text() : undefined;

  const res = await fetch(targetUrl, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      // Fastify's JSON parser rejects an empty body sent with this header
      // (e.g. a bodyless POST like key rotation), so only set it when there
      // is actually a body to parse.
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body || undefined,
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
