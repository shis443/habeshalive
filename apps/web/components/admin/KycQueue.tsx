"use client";

import type { KycAdminItem } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function KycQueue({ items }: { items: KycAdminItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function viewDocument(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/kyc/${id}/document-url`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load document");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  async function approve(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/kyc/${id}/approve`, { method: "POST" });
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
    const reason = window.prompt("Reason for rejecting (shown to the creator):");
    if (!reason) return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/kyc/${id}/reject`, {
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

  if (items.length === 0) return <p className={styles.empty}>No submissions here.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>@{item.username}</span>
              <span className={styles.rowDetail}>{item.idType === "fayda" ? "Fayda Digital ID" : "Kebele ID"}</span>
              <span className={styles.rowMeta}>Submitted {new Date(item.submittedAt).toLocaleString()}</span>
              {item.rejectionReason && <span className={styles.rowMeta}>Reason: {item.rejectionReason}</span>}
              {item.reviewerUsername && <span className={styles.rowMeta}>Reviewed by @{item.reviewerUsername}</span>}
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.denyButton} onClick={() => viewDocument(item.id)}>
                View document
              </button>
              {item.status === "pending" && (
                <>
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
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
