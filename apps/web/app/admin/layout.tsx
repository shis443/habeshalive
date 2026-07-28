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
  if (user.role !== "admin") redirect("/");

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
