import { AuditLogFilters } from "@/components/admin/AuditLogFilters";
import { AuditLogList } from "@/components/admin/AuditLogList";
import { getAdminAuditLog } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; limit?: string }>;
}) {
  const { action, limit } = await searchParams;
  const items = await getAdminAuditLog({ action, limit: limit ? Number(limit) : undefined });

  return (
    <>
      <h1 className={styles.heading}>Audit Log</h1>
      <p className={styles.subtext}>Every admin action across the panel — actor, action, target, reason, and when.</p>
      <AuditLogFilters />
      <AuditLogList items={items} />
    </>
  );
}
