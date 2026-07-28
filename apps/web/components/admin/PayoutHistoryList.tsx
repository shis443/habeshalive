import { formatSantimAsBirr, type PayoutHistoryItem } from "@habeshalive/shared";
import styles from "./AdminQueue.module.css";

const STATUS_LABEL: Record<PayoutHistoryItem["status"], string> = {
  pending_review: "Pending review",
  processing: "Processing",
  paid: "Paid",
  failed: "Failed / rejected",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function PayoutHistoryList({ items }: { items: PayoutHistoryItem[] }) {
  if (items.length === 0) return <p className={styles.empty}>No payouts match this filter.</p>;

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <div key={item.id} className={styles.row}>
          <div className={styles.rowMain}>
            <span className={styles.rowTitle}>
              {formatSantimAsBirr(item.amountSantim)} to @{item.creatorUsername}
            </span>
            <span className={styles.rowMeta}>
              {item.method} — {item.destination} · {formatDate(item.createdAt)}
            </span>
            {item.failureReason && <span className={styles.rowMeta}>Reason: {item.failureReason}</span>}
            {item.approvedByUsername && <span className={styles.rowMeta}>Approved by @{item.approvedByUsername}</span>}
            {item.rejectedByUsername && <span className={styles.rowMeta}>Rejected by @{item.rejectedByUsername}</span>}
          </div>
          <span className={styles.rowMeta}>{STATUS_LABEL[item.status]}</span>
        </div>
      ))}
    </div>
  );
}
