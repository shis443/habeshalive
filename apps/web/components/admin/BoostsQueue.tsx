"use client";

import { formatSantimAsBirr, type ActiveBoost } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function BoostsQueue({ items }: { items: ActiveBoost[] }) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setCancellingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/boosts/${id}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel boost");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCancellingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No streams are currently boosted.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>@{item.creatorUsername}</span>
              <span className={styles.rowMeta}>
                {formatSantimAsBirr(item.priceSantim)} — ends{" "}
                {new Date(item.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.denyButton}
                disabled={cancellingId === item.id}
                onClick={() => cancel(item.id)}
              >
                {cancellingId === item.id ? "Cancelling..." : "Cancel & refund"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
