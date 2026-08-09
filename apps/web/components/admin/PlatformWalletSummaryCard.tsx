import { formatSantimAsBirr, type PlatformWalletSummary } from "@birq/shared";
import styles from "./LedgerPanels.module.css";

export function PlatformWalletSummaryCard({ data }: { data: PlatformWalletSummary | null }) {
  if (!data) return <p className={styles.error}>Couldn&apos;t load platform wallet summary.</p>;

  const maxAbs = Math.max(1, ...data.last30Days.map((d) => Math.abs(d.netSantim)));

  return (
    <div>
      <p className={styles.currentBalance}>{formatSantimAsBirr(data.currentBalanceSantim)}</p>
      {data.last30Days.length === 0 ? (
        <p className={styles.subtext}>No ledger activity in the last 30 days.</p>
      ) : (
        <div className={styles.dayBars}>
          {data.last30Days.map((day) => (
            <div key={day.day} className={styles.dayBar} title={`${day.day}: ${formatSantimAsBirr(day.netSantim)}`}>
              <div
                className={day.netSantim >= 0 ? styles.barPositive : styles.barNegative}
                style={{ height: `${Math.max(4, (Math.abs(day.netSantim) / maxAbs) * 60)}px` }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
