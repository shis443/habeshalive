import { cookies, headers } from "next/headers";
import { TopNavClient } from "./TopNavClient";

// Same detection BottomNav.tsx uses. The web top bar (logo, search,
// notification bell, settings gear, LOG IN / SIGN UP) was the half of the
// double-nav problem BottomNav's own suppression missed — the native
// shell's RootTabView owns navigation entirely when embedded, and
// LOG IN / SIGN UP specifically move to the native Profile tab (its web
// content is /account, which already has its own auth entry points) —
// no new native auth screen was built for this, since the web route
// already covers it once it's reachable from a tab instead of hidden
// behind a suppressed top bar.
export async function TopNav({ isAuthed }: { isAuthed: boolean }) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const isNativeShell =
    cookieStore.get("birq_native")?.value === "1" || (headerStore.get("user-agent") ?? "").includes("BirqApp");

  if (isNativeShell) return null;

  return <TopNavClient isAuthed={isAuthed} />;
}
