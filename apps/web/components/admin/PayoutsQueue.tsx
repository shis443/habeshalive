"use client";

import { formatSantimAsBirr, type PayoutQueueItem } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function PayoutsQueue({ items }: { items: PayoutQueueItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/wallet/payouts/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to approve payout");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No payouts awaiting review.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                {formatSantimAsBirr(item.amountSantim)} to @{item.creatorUsername}
              </span>
              <span className={styles.rowMeta}>
                {item.method} — {item.destination}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.approveButton}
                disabled={pendingId === item.id}
                onClick={() => approve(item.id)}
              >
                {pendingId === item.id ? "Approving..." : "Approve"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
