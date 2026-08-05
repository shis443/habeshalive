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
  // db/migrations/0026_rbac_role_isolation.sql renamed 'admin' to
  // 'super_admin'. Deliberately still super_admin-only, not widened to
  // also admit the new moderator/finance_auditor roles here: every admin
  // API route this shell's pages call still requires app.requireAdmin
  // (also super_admin-only, see apps/api/src/app.ts) — none have been
  // retrofitted to the new fine-grained app.requirePermission checks yet,
  // so granting those roles access to this shell today would show a UI
  // that then 403s on every actual data fetch. Widening this gate is
  // future work, done together with retrofitting the routes it would
  // actually unlock.
  if (user.role !== "super_admin") redirect("/");

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
