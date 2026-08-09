import { loginResultSchema, loginSchema, verifyEmailOtpSchema, verifyOtpSchema, type AuthResponse } from "@birq/shared";
import { NextResponse, type NextRequest } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { clearSessionCookie, getSessionCookie, MAX_ACCOUNTS, writeSessionCookie } from "@/lib/session";

// Shared by this route's normal login/signup completion and
// api/session/2fa/route.ts's post-TOTP-challenge completion — both reach
// the same "we now have a real {token, user}" point and need the same
// account-switcher-aware cookie write (E.2).
export async function completeSessionFromAuthResponse(
  { token, user }: AuthResponse,
  req: NextRequest
): Promise<NextResponse> {
  const addAccount = req.nextUrl.searchParams.get("addAccount") === "true";
  const existing = addAccount ? await getSessionCookie() : null;

  const newEntry = { userId: user.id, username: user.username, token };
  const withoutThisUser = (existing?.accounts ?? []).filter((a) => a.userId !== user.id);
  const accounts = [...withoutThisUser, newEntry].slice(-MAX_ACCOUNTS);

  await writeSessionCookie({ activeUserId: user.id, accounts });

  return NextResponse.json({ user });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.json();
  // Three request shapes share this one endpoint — password login
  // (identifier field, checked first since it's the default returning-user
  // path), phone OTP (phoneNumber field), and email OTP (email field) —
  // routed to their matching upstream API endpoint based on which one the
  // body actually has.
  const isLogin = typeof rawBody === "object" && rawBody !== null && "identifier" in rawBody;
  const isEmail = !isLogin && typeof rawBody === "object" && rawBody !== null && "email" in rawBody;
  const body = isLogin
    ? loginSchema.parse(rawBody)
    : isEmail
      ? verifyEmailOtpSchema.parse(rawBody)
      : verifyOtpSchema.parse(rawBody);
  const upstreamPath = isLogin ? "/auth/login" : isEmail ? "/auth/verify-email-otp" : "/auth/verify-otp";

  // Route Handler — runs server-side, needs API_INTERNAL_URL (see config.ts).
  const res = await fetch(`${API_INTERNAL_URL}${upstreamPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  // Login now returns one of two shapes (see shared/schemas/auth.ts's
  // loginResultSchema) — a real AuthResponse (2FA not enabled, unchanged
  // behavior), or a TotpChallenge (2FA enabled: no session cookie is
  // written yet, the caller must finish via POST /api/session/2fa with
  // the returned pendingToken + a code). Parsing the union rather than
  // authResponseSchema directly is what's fixed here — the old code threw
  // a Zod error on every 2FA-enabled login instead of surfacing the
  // challenge.
  const result = loginResultSchema.parse(data);
  if ("requiresTotp" in result) {
    return NextResponse.json(result);
  }

  return completeSessionFromAuthResponse(result, req);
}

export async function DELETE(req: NextRequest) {
  // ?all=true: "Log out of all accounts." Otherwise: "Log out of [current
  // account]" — removes just the active one and falls back to whichever
  // account is next in the list, if any are left.
  const logoutAll = req.nextUrl.searchParams.get("all") === "true";
  if (logoutAll) {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  const session = await getSessionCookie();
  if (!session) {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  const remaining = session.accounts.filter((a) => a.userId !== session.activeUserId);
  if (remaining.length === 0) {
    await clearSessionCookie();
  } else {
    await writeSessionCookie({ activeUserId: remaining[remaining.length - 1]!.userId, accounts: remaining });
  }
  return NextResponse.json({ ok: true });
}
