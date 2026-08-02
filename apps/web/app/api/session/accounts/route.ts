import { authUserSchema, type SessionAccount } from "@habeshalive/shared";
import { NextResponse } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";
import { getSessionCookie } from "@/lib/session";

// E.2 account switcher data source. Deliberately fetches each account's
// display info live (via its own token against /auth/me) rather than
// trusting anything cached in the cookie — the cookie only carries
// username (see session.ts), so displayName/avatarUrl/role always reflect
// the real current state, and a revoked/expired token surfaces as
// isStale instead of silently showing wrong data.
export async function GET() {
  const session = await getSessionCookie();
  if (!session) return NextResponse.json<SessionAccount[]>([]);

  const results = await Promise.all(
    session.accounts.map(async (account): Promise<SessionAccount> => {
      try {
        const res = await fetch(`${API_INTERNAL_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${account.token}` },
          cache: "no-store",
        });
        if (!res.ok) {
          return {
            userId: account.userId,
            username: account.username,
            displayName: account.username,
            avatarUrl: null,
            isActive: account.userId === session.activeUserId,
            isStale: true,
          };
        }
        const user = authUserSchema.parse(await res.json());
        return {
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isActive: account.userId === session.activeUserId,
          isStale: false,
        };
      } catch {
        return {
          userId: account.userId,
          username: account.username,
          displayName: account.username,
          avatarUrl: null,
          isActive: account.userId === session.activeUserId,
          isStale: true,
        };
      }
    })
  );

  return NextResponse.json(results);
}
