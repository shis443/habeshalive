import { formatSantimAsBirr, type BoostRevenueByCreator } from "@habeshalive/shared";
import styles from "./AdminQueue.module.css";

export function BoostRevenueList({ items }: { items: BoostRevenueByCreator[] }) {
  if (items.length === 0) return <p className={styles.empty}>No boost revenue yet.</p>;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div key={item.creatorUsername} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>@{item.creatorUsername}</span>
            <span className={styles.rowMeta}>{item.boostCount} boosts</span>
          </div>
          <span className={styles.rowMeta}>{formatSantimAsBirr(item.totalSantim)}</span>
        </div>
      ))}
    </div>
  );
}
