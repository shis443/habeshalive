import type { ModerationActionRecord } from "@habeshalive/shared";
import styles from "./AdminQueue.module.css";

const ACTION_LABEL: Record<ModerationActionRecord["action"], string> = {
  ban: "Banned",
  unban: "Unbanned",
  timeout: "Timed out",
  delete_message: "Deleted message from",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ModerationActionHistory({ items }: { items: ModerationActionRecord[] }) {
  if (items.length === 0) return <p className={styles.empty}>No moderation actions recorded yet.</p>;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div key={item.id} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>
              @{item.actorUsername} {ACTION_LABEL[item.action].toLowerCase()} @{item.targetUsername}
              {item.durationSeconds ? ` for ${Math.round(item.durationSeconds / 60)}m` : ""}
            </span>
            {item.reason && <span className={styles.rowMeta}>Reason: {item.reason}</span>}
          </div>
          <span className={styles.rowMeta}>{formatDate(item.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
