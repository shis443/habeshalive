import type { AdminAuditAction } from "@habeshalive/shared";
import styles from "./AdminQueue.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join(", ");
}

export function AuditLogList({ items }: { items: AdminAuditAction[] }) {
  if (items.length === 0) return <p className={styles.empty}>No admin actions match this filter.</p>;

  return (
    <div className={styles.list}>
      {items.map((item) => {
        const metadata = formatMetadata(item.metadata);
        return (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                @{item.actorUsername} — {item.action}
                {item.targetId ? ` (${item.targetType}: ${item.targetId.slice(0, 8)})` : ` (${item.targetType})`}
              </span>
              {item.reason && <span className={styles.rowMeta}>Reason: {item.reason}</span>}
              {metadata && <span className={styles.rowMeta}>{metadata}</span>}
            </div>
            <span className={styles.rowMeta}>{formatDate(item.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
