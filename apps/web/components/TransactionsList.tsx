import { formatSantimAsBirr, type Transaction } from "@birq/shared";
import styles from "./TransactionsList.module.css";

const STATUS_LABEL: Record<Transaction["status"], string> = {
  pending: "Pending",
  completed: "Success",
  failed: "Failed",
  reversed: "Reversed",
};

function statusClass(status: Transaction["status"]): string {
  switch (status) {
    case "pending":
      return styles.statusPending ?? "";
    case "completed":
      return styles.statusCompleted ?? "";
    case "failed":
    case "reversed":
      return styles.statusFailed ?? "";
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TransactionsList({ transactions }: { transactions: Transaction[] }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Recent transactions</h2>
      {transactions.length === 0 ? (
        <p className={styles.empty}>No transactions yet.</p>
      ) : (
        <div>
          {transactions.map((tx) => (
            <div key={tx.id} className={styles.row}>
              <div>
                <p className={styles.title}>{tx.title}</p>
                <p className={styles.timestamp}>{formatTimestamp(tx.createdAt)}</p>
              </div>
              <div className={styles.amountWrap}>
                <span className={tx.direction === "credit" ? styles.amountCredit : styles.amountDebit}>
                  {tx.direction === "credit" ? "+" : "-"}
                  {formatSantimAsBirr(tx.amountSantim)}
                </span>
                <span className={`${styles.statusPill} ${statusClass(tx.status)}`}>
                  {STATUS_LABEL[tx.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
