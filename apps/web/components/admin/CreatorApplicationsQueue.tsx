"use client";

import type { CreatorApplicationAdminItem } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function CreatorApplicationsQueue({ items }: { items: CreatorApplicationAdminItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/creator-applications/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to approve");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting (optional):") ?? undefined;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/creator-applications/${id}/reject`, {
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

  if (items.length === 0) return <p className={styles.empty}>No applications here.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>@{item.applicantUsername}</span>
              <span className={styles.rowDetail}>&ldquo;{item.applicationText}&rdquo;</span>
              {item.socialLinks && <span className={styles.rowMeta}>Links: {item.socialLinks}</span>}
              {item.reviewerUsername && (
                <span className={styles.rowMeta}>Reviewed by @{item.reviewerUsername}</span>
              )}
            </div>
            {item.status === "pending" && (
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
                  onClick={() => approve(item.id)}
                >
                  Approve
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
