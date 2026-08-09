import { formatSantimAsBirr, type AdRevenueByCreator } from "@birq/shared";
import styles from "./AdminQueue.module.css";

export function AdRevenuePanel({ items }: { items: AdRevenueByCreator[] }) {
  if (items.length === 0) return <p className={styles.empty}>No ad revenue recorded yet.</p>;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div key={item.creatorId} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>@{item.creatorUsername}</span>
            <span className={styles.rowMeta}>{item.impressionCount} impressions</span>
          </div>
          <span className={styles.rowTitle}>{formatSantimAsBirr(item.totalSantim)}</span>
        </div>
      ))}
    </div>
  );
}
