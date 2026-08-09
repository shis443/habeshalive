import { switchAccountSchema } from "@birq/shared";
import { NextResponse } from "next/server";
import { getSessionCookie, writeSessionCookie } from "@/lib/session";

// Instant, no Fastify round-trip — just flips which stored token is
// "active" inside the one httpOnly cookie. This is what actually delivers
// E.2's "switching is instant, no re-auth" requirement.
export async function POST(req: Request) {
  const { userId } = switchAccountSchema.parse(await req.json());

  const session = await getSessionCookie();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const target = session.accounts.find((a) => a.userId === userId);
  if (!target) return NextResponse.json({ error: "That account isn't signed in on this device" }, { status: 404 });

  await writeSessionCookie({ activeUserId: userId, accounts: session.accounts });
  return NextResponse.json({ ok: true });
}
