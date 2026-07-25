import type { ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser } from "@/lib/api";
import styles from "./StaticPageLayout.module.css";

// Shared chrome for the "More" menu's content pages (About, Careers,
// Community Guidelines, etc.) — same TopNav/BottomNav/prose container every
// other page uses, so these don't need their own bespoke layout each. No
// auth required: all of these are logged-out-accessible.
export async function StaticPageLayout({ title, children }: { title: string; children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      <TopNav isAuthed={!!user} />
      <main className={styles.main}>
        <h1 className={styles.heading}>{title}</h1>
        <div className={styles.prose}>{children}</div>
      </main>
      <BottomNav />
    </>
  );
}
