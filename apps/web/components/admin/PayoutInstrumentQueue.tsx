"use client";

import type { PayoutInstrumentAdminItem } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function PayoutInstrumentQueue({ items }: { items: PayoutInstrumentAdminItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/payout-instruments/${id}/verify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to verify");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting (shown to the creator):");
    if (!reason) return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/payout-instruments/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reject");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No payout methods awaiting review.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>@{item.username}</span>
              <span className={styles.rowMeta}>
                {item.method === "telebirr" ? "Telebirr" : "Bank"} ····{item.displayTail} — {item.accountHolder}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.denyButton}
                disabled={pendingId === item.id}
                onClick={() => reject(item.id)}
              >
                Reject
              </button>
              <button
                type="button"
                className={styles.approveButton}
                disabled={pendingId === item.id}
                onClick={() => verify(item.id)}
              >
                Verify
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
