import { cookies, headers } from "next/headers";
import { BottomNavClient, type NavTab } from "./BottomNavClient";

// The native app embeds this web app in a full-screen WKWebView with its
// own TabView tab bar (Birq/View/RootTabView.swift) — rendering this bar
// too would stack two navigation systems on screen at once. The WKWebView
// sets a birq_native cookie unconditionally on creation (auth-independent,
// unlike the mobile-bridge session cookie which only fires for logged-in
// users) plus applicationNameForUserAgent="BirqApp/1.0" as a belt-and-braces
// signal readable before any cookie round-trip completes.
export async function BottomNav({ active }: { active?: NavTab }) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const isNativeShell =
    cookieStore.get("birq_native")?.value === "1" || (headerStore.get("user-agent") ?? "").includes("BirqApp");

  if (isNativeShell) return null;

  return <BottomNavClient active={active} />;
}
