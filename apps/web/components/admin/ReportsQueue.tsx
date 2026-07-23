"use client";

import type { Report } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function ReportsQueue({ items }: { items: Report[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string, status: "actioned" | "dismissed") {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/moderation/reports/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to resolve report");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No reports awaiting review.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                {item.reason.replace("_", " ")} — {item.targetType}
              </span>
              <span className={styles.rowMeta}>reported by @{item.reporterUsername}</span>
              {item.details && <span className={styles.rowDetail}>{item.details}</span>}
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.denyButton}
                disabled={pendingId === item.id}
                onClick={() => resolve(item.id, "dismissed")}
              >
                Dismiss
              </button>
              <button
                type="button"
                className={styles.approveButton}
                disabled={pendingId === item.id}
                onClick={() => resolve(item.id, "actioned")}
              >
                Mark actioned
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
