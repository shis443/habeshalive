import { NextResponse, type NextRequest } from "next/server";

// TEMPORARY — added to catch the "The string did not match the expected
// pattern." login error, which reproduces live on-device but has no trace
// anywhere in this codebase or its dependencies (checked: not a literal
// string match anywhere including node_modules, no `pattern` attribute on
// the identifier/password/email inputs, and the live /auth/login endpoint
// returns a clean, correct error for a well-formed request). LoginForm.tsx
// posts here from every one of its catch blocks with the raw error's
// message/stack, tagged by which handler caught it — that's the actual
// throw site we don't have visibility into otherwise. Remove this route
// and its LoginForm.tsx call sites once that's found.
//
// Never receives credentials — only the caught error's own message/stack
// and a context tag, never the request body LoginForm was submitting.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const context = typeof body?.context === "string" ? body.context.slice(0, 100) : "unknown";
  const message = typeof body?.message === "string" ? body.message.slice(0, 2000) : "unknown";
  const stack = typeof body?.stack === "string" ? body.stack.slice(0, 4000) : "unknown";
  const userAgent = req.headers.get("user-agent") ?? "unknown";

  // console.error rather than a store — Vercel's function logs are exactly
  // what's being read back to diagnose this, no extra infra needed for
  // what's meant to be removed again shortly.
  console.error(
    `[LOGIN_DIAG] context=${context} ua=${JSON.stringify(userAgent)} message=${JSON.stringify(message)} stack=${JSON.stringify(stack)}`
  );

  return NextResponse.json({ ok: true });
}
