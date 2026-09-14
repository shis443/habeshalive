"use client";

import type { EmoteAdminItem } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import styles from "./AdminQueue.module.css";

// Build 3 — Birq Plus's "global emote slot" review queue. Same
// approve/reject-with-reason shape as KycQueue.tsx, an image preview in
// place of KYC's "view document" link since an emote's whole point is a
// small, safely-inlinable image (unlike a KYC document).
export function EmoteQueue({ items }: { items: EmoteAdminItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/emotes/${id}/approve`, { method: "POST" });
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
      const res = await fetch(`/api/backend/admin/emotes/${id}/reject`, {
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveAvatarUrl(item.imageUrl) ?? undefined}
              alt={item.code}
              width={32}
              height={32}
              style={{ borderRadius: 4, objectFit: "contain", background: "var(--surface-container-high)" }}
            />
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>:{item.code}:</span>
              <span className={styles.rowDetail}>by @{item.createdByUsername}</span>
              <span className={styles.rowMeta}>Submitted {new Date(item.createdAt).toLocaleString()}</span>
              {item.rejectionReason && <span className={styles.rowMeta}>Reason: {item.rejectionReason}</span>}
            </div>
            <div className={styles.actions}>
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
