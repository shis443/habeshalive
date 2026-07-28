import type { StreamArchiveItem } from "@habeshalive/shared";
import styles from "./AdminQueue.module.css";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function StreamArchiveList({ items }: { items: StreamArchiveItem[] }) {
  if (items.length === 0) return <p className={styles.empty}>No past streams match this filter.</p>;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div key={item.id} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>
              {item.title} — @{item.creatorUsername}
            </span>
            <span className={styles.rowMeta}>
              {item.category ?? "Uncategorized"} · Peak {item.peakViewers} viewers · {formatDate(item.startedAt)} –{" "}
              {formatDate(item.endedAt)}
            </span>
          </div>
          <span className={styles.rowMeta}>{item.vodId ? "VOD retained" : "No VOD"}</span>
        </div>
      ))}
    </div>
  );
}
