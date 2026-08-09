import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { CreatorDashboardSidebar } from "@/components/CreatorDashboardSidebar";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser } from "@/lib/api";
import styles from "./layout.module.css";

// Same shell pattern as app/admin/layout.tsx (TopNav/BottomNav still wrap
// everything, a sidebar sits alongside the page content) — reused rather
// than inventing Twitch's own separate full-chrome-replacement dashboard
// shell, since this app already has that exact "section with its own
// sidebar nav" precedent for /admin.
//
// No creator-only gate here (unlike /admin's role check) — this page was
// already reachable by any signed-in user before the sidebar reskin
// (streamKey being null just meant GoLivePanel didn't render), and that's
// this app's real self-serve "become a creator" entry point. Individual
// subpages show their own empty/prompt state for a non-creator instead.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/dashboard");

  return (
    <>
      <TopNav isAuthed />
      <div className={styles.shell}>
        <CreatorDashboardSidebar />
        <main className={styles.content}>{children}</main>
      </div>
      <BottomNav active="go-live" />
    </>
  );
}
