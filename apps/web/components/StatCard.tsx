import styles from "./StatCard.module.css";

export function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string;
}) {
  return (
    <div className={styles.card}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {delta && <span className={styles.delta}>{delta}</span>}
    </div>
  );
}
