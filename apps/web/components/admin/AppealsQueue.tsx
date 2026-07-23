"use client";

import type { Appeal } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function AppealsQueue({ items }: { items: Appeal[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string, action: "approve" | "deny") {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/moderation/appeals/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to resolve appeal");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No appeals awaiting review.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>@{item.username}</span>
              <span className={styles.rowDetail}>{item.reason}</span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.denyButton}
                disabled={pendingId === item.id}
                onClick={() => resolve(item.id, "deny")}
              >
                Deny
              </button>
              <button
                type="button"
                className={styles.approveButton}
                disabled={pendingId === item.id}
                onClick={() => resolve(item.id, "approve")}
              >
                Approve (unban)
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
