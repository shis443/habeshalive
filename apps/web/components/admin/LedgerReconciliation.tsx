import { formatSantimAsBirr, type LedgerReconciliation } from "@birq/shared";
import styles from "./LedgerPanels.module.css";

export function LedgerReconciliationCard({ data }: { data: LedgerReconciliation | null }) {
  if (!data) return <p className={styles.error}>Couldn&apos;t load reconciliation check.</p>;

  return (
    <div className={data.balanced ? styles.reconciled : styles.unreconciled}>
      <span className={styles.reconciliationStatus}>
        {data.balanced ? "✓ Balanced" : "✗ NOT BALANCED — investigate immediately"}
      </span>
      <div className={styles.reconciliationRow}>
        <span>Total credits: {formatSantimAsBirr(data.totalCreditsSantim)}</span>
        <span>Total debits: {formatSantimAsBirr(data.totalDebitsSantim)}</span>
      </div>
    </div>
  );
}
