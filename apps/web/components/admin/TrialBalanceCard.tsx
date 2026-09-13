import { formatSantimAsBirr, type TrialBalance } from "@birq/shared";
import styles from "./LedgerPanels.module.css";

// Not a "sums to zero" check — a viewer's unspent topped-up balance is a
// real, nonzero wallet balance too, so platform + creator wallets alone
// never actually sums to zero. What's checked instead: the SAME quantity
// (platform + every creator wallet) computed two independent ways — the
// cache, and a fresh sum straight from ledger_entries — with any
// disagreement surfaced as drift. See admin/ledger-service.ts's
// getTrialBalance for the full reasoning.
export function TrialBalanceCard({ data }: { data: TrialBalance | null }) {
  if (!data) return <p className={styles.error}>Couldn&apos;t load trial balance.</p>;

  return (
    <div className={data.balanced ? styles.reconciled : styles.unreconciled}>
      <span className={styles.reconciliationStatus}>
        {data.balanced ? "✓ Cache matches the ledger" : "✗ CACHE DRIFT DETECTED — investigate immediately"}
      </span>
      <div className={styles.reconciliationRow}>
        <span>Platform wallet: {formatSantimAsBirr(data.platformWalletBalanceSantim)}</span>
        <span>Creator liability: {formatSantimAsBirr(data.creatorLiabilitySantim)}</span>
        <span>In-flight batches: {formatSantimAsBirr(data.unsettledBatchSantim)}</span>
      </div>
      <div className={styles.reconciliationRow}>
        <span>Cached sum: {formatSantimAsBirr(data.cachedSumSantim)}</span>
        <span>Ledger-derived sum: {formatSantimAsBirr(data.ledgerDerivedSumSantim)}</span>
        <span>Drift: {formatSantimAsBirr(data.driftSantim)}</span>
      </div>
    </div>
  );
}
