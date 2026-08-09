"use client";

import { formatSantimAsBirr, type SubscriptionAdminItem } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function SubscriptionsAdminList({ items, atRisk }: { items: SubscriptionAdminItem[]; atRisk: boolean }) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function extendGrace(id: string) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/subscriptions/${id}/extend-grace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 7 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to extend grace period");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function forceCancel(id: string) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/subscriptions/${id}/force-cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  if (items.length === 0) {
    return <p className={styles.empty}>{atRisk ? "No subscriptions are currently at risk." : "No active subscriptions."}</p>;
  }

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                @{item.subscriberUsername} → @{item.creatorUsername}
              </span>
              <span className={styles.rowMeta}>
                {item.tierName} · {formatSantimAsBirr(item.priceSantim)}/mo · expires {formatDate(item.expiresAt)}
              </span>
            </div>
            {atRisk && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.approveButton}
                  disabled={savingId === item.id}
                  onClick={() => extendGrace(item.id)}
                >
                  Extend 7 days
                </button>
                <button
                  type="button"
                  className={styles.denyButton}
                  disabled={savingId === item.id}
                  onClick={() => forceCancel(item.id)}
                >
                  Force-cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
