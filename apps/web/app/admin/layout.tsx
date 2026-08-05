import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { BottomNav } from "@/components/BottomNav";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser } from "@/lib/api";
import styles from "./layout.module.css";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin");
  // db/migrations/0026_rbac_role_isolation.sql renames 'admin' to
  // 'super_admin'. Legacy 'admin' is accepted permanently alongside it —
  // this web app (Vercel) and the API (Fly) deploy independently and
  // don't restart in the same instant a migration commits, so code that
  // checked only "super_admin" could reject every real admin depending on
  // exact deploy timing relative to the migration. Same reasoning and
  // same permanent-not-temporary intent as apps/api/src/app.ts's
  // requireAdmin/requireRole. Still deliberately NOT widened to admit the
  // new moderator/finance_auditor roles here: only the routes explicitly
  // retrofitted in db/migrations/0027_permission_grants.sql's rollout
  // (apps/api/src/moderation/routes.ts, parts of admin/routes.ts) accept
  // those roles — most of this shell's pages still call routes that
  // require full admin access, so granting broader roles entry to the
  // shell itself would show a UI that 403s on most of what it renders.
  if (user.role !== "super_admin" && user.role !== "admin") redirect("/");

  return (
    <>
      <TopNav isAuthed />
      <div className={styles.shell}>
        <AdminSidebar />
        <main className={styles.content}>{children}</main>
      </div>
      <BottomNav />
    </>
  );
}
