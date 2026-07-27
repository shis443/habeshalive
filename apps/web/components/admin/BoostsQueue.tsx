import { formatSantimAsBirr, type ActiveBoost } from "@habeshalive/shared";
import styles from "./AdminQueue.module.css";

export function BoostsQueue({ items }: { items: ActiveBoost[] }) {
  if (items.length === 0) return <p className={styles.empty}>No streams are currently boosted.</p>;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div key={item.id} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>@{item.creatorUsername}</span>
            <span className={styles.rowMeta}>
              {formatSantimAsBirr(item.priceSantim)} — ends {new Date(item.endsAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
