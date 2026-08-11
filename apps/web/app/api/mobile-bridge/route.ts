import { NextResponse, type NextRequest } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { getSessionCookie, MAX_ACCOUNTS, writeSessionCookie } from "@/lib/session";

// Landing point for the mobile app's "open an authenticated web view" bridge
// (BirqApi.createWebBridgeCode on the mobile side, POST /auth/web-bridge-code
// on the API — see apps/api/src/auth/web-bridge-service.ts's own comment for
// the full rationale). The mobile app opens
// https://birq.live/api/mobile-bridge?code=...&redirect=/browse in a
// WKWebView (Birq/View/BirqExplore/BirqExploreView.swift — not
// SFSafariViewController, that's used elsewhere in the app for a separate
// mid-broadcast utility browser); this route exchanges the one-time code for
// a real session server-side and hands the browser off to `redirect` already
// signed in — the code and the resulting token never reach client JS.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const redirectTo = req.nextUrl.searchParams.get("redirect") ?? "/wallet";
  // Only ever a same-site path — a code that unlocks a real session must
  // never be handed to an open redirect.
  const safeRedirect = redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/wallet";

  if (!code) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const res = await fetch(`${API_INTERNAL_URL}/auth/web-bridge-code/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.redirect(new URL("/login?error=bridge_expired", req.url));
  }

  const { userId, username, token } = (await res.json()) as { userId: string; username: string; token: string };

  // Same account-merge behavior as apps/web/app/api/session/route.ts's
  // completeSessionFromAuthResponse — a viewer who's already got other
  // accounts signed in on this browser keeps them, this one just becomes
  // active, not a hard reset of the whole cookie.
  const existing = await getSessionCookie();
  const newEntry = { userId, username, token };
  const withoutThisUser = (existing?.accounts ?? []).filter((a) => a.userId !== userId);
  const accounts = [...withoutThisUser, newEntry].slice(-MAX_ACCOUNTS);
  await writeSessionCookie({ activeUserId: userId, accounts });

  return NextResponse.redirect(new URL(safeRedirect, req.url));
}
