import { type AuthResponse } from "@birq/shared";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie, MAX_ACCOUNTS, writeSessionCookie } from "@/lib/session";

// Shared by api/session/route.ts's normal login/signup completion and
// api/session/2fa/route.ts's post-TOTP-challenge completion — both reach
// the same "we now have a real {token, user}" point and need the same
// account-switcher-aware cookie write (E.2).
//
// Lives here rather than in the route file that used to own it: Next
// only permits its own known exports (GET/POST/route config) from a
// `route.ts`, so exporting this helper from one made `next build` fail
// type checking outright ("not a valid Route export field") — the whole
// web build, not just that route.
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
