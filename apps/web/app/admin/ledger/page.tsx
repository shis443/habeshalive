import { LedgerLookup } from "@/components/admin/LedgerLookup";
import { LedgerReconciliationCard } from "@/components/admin/LedgerReconciliation";
import { ManualAdjustmentForm } from "@/components/admin/ManualAdjustmentForm";
import { PlatformWalletSummaryCard } from "@/components/admin/PlatformWalletSummaryCard";
import { getLedgerReconciliation, getPlatformWalletSummary } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminLedgerPage() {
  const [reconciliation, walletSummary] = await Promise.all([
    getLedgerReconciliation(),
    getPlatformWalletSummary(),
  ]);

  return (
    <>
      <h1 className={styles.heading}>Ledger & Finance</h1>

      <h2 className={styles.sectionTitle}>Reconciliation check</h2>
      <LedgerReconciliationCard data={reconciliation} />

      <h2 className={styles.sectionTitle}>Platform wallet balance</h2>
      <div className={styles.section}>
        <PlatformWalletSummaryCard data={walletSummary} />
      </div>

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Transaction lookup</h2>
      <LedgerLookup />

      <h2 className={`${styles.sectionTitle} ${styles.sectionTitleSpaced}`}>Manual adjustment</h2>
      <ManualAdjustmentForm />
    </>
  );
}
