"use client";

import { formatSantimAsBirr, type GiftCardAdminItem } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function GiftCardsPanel({
  items,
  suspicious,
}: {
  items: GiftCardAdminItem[];
  suspicious: { username: string; count: number }[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    if (!window.confirm("Cancel this gift card and refund the purchaser?")) return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/gift-cards/${id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      {suspicious.length > 0 && (
        <div className={styles.flaggedBlock}>
          <p className={styles.rowTitle}>Flagged: bulk purchasing in the last 24h</p>
          {suspicious.map((s) => (
            <span key={s.username} className={styles.rowMeta}>
              @{s.username} — {s.count} gift cards
            </span>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className={styles.empty}>No gift cards yet.</p>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <div key={item.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {item.code} — {formatSantimAsBirr(item.amountSantim)} ({item.designTheme})
                </span>
                <span className={styles.rowMeta}>
                  From @{item.purchaserUsername ?? "unknown"} · {item.recipientEmail ?? item.recipientPhone ?? "link delivery"} ·{" "}
                  {item.status}
                  {item.redeemedByUsername && ` · redeemed by @${item.redeemedByUsername}`}
                </span>
              </div>
              {item.status === "issued" && (
                <button
                  type="button"
                  className={styles.denyButton}
                  disabled={pendingId === item.id}
                  onClick={() => cancel(item.id)}
                >
                  Cancel & refund
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
