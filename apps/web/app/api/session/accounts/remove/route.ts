import { removeAccountSchema } from "@birq/shared";
import { NextResponse } from "next/server";
import { clearSessionCookie, getSessionCookie, writeSessionCookie } from "@/lib/session";

// Removes one account from the switcher list without it needing to be the
// active one — e.g. clearing a stale/revoked entry, or signing another
// account on a shared device out from under it without switching to it
// first.
export async function POST(req: Request) {
  const { userId } = removeAccountSchema.parse(await req.json());

  const session = await getSessionCookie();
  if (!session) return NextResponse.json({ ok: true });

  const remaining = session.accounts.filter((a) => a.userId !== userId);
  if (remaining.length === 0) {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  const activeUserId = session.activeUserId === userId ? remaining[remaining.length - 1]!.userId : session.activeUserId;
  await writeSessionCookie({ activeUserId, accounts: remaining });
  return NextResponse.json({ ok: true });
}
