"use client";

import { formatSantimAsBirr, type CreatorPayoutContext, type PayoutQueueItem } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function PayoutsQueue({ items }: { items: PayoutQueueItem[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [context, setContext] = useState<CreatorPayoutContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function toggleExpand(item: PayoutQueueItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    setRejectingId(null);
    setContext(null);
    setContextLoading(true);
    try {
      const res = await fetch(`/api/backend/wallet/payouts/creator-context/${item.creatorId}`);
      if (res.ok) setContext(await res.json());
    } finally {
      setContextLoading(false);
    }
  }

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

  async function reject(id: string) {
    if (!rejectReason.trim()) return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/wallet/payouts/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reject payout");
      setRejectingId(null);
      setRejectReason("");
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
        {items.map((item) => {
          const expanded = expandedId === item.id;
          return (
            <div key={item.id} className={styles.rowStack}>
              <div className={`${styles.row} ${styles.rowExpandable}`} onClick={() => toggleExpand(item)}>
                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>
                    {formatSantimAsBirr(item.amountSantim)} to @{item.creatorUsername}
                  </span>
                  <span className={styles.rowMeta}>
                    {item.method} — {item.destination}
                  </span>
                </div>
                <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={styles.approveButton}
                    disabled={pendingId === item.id}
                    onClick={() => approve(item.id)}
                  >
                    {pendingId === item.id ? "Approving..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    className={styles.denyButton}
                    disabled={pendingId === item.id}
                    onClick={() => {
                      setRejectingId(rejectingId === item.id ? null : item.id);
                      setExpandedId(item.id);
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>

              {expanded && (
                <div className={styles.context}>
                  {contextLoading && <span>Loading creator context…</span>}
                  {context && (
                    <>
                      <span className={styles.contextItem}>
                        Lifetime paid: <strong>{formatSantimAsBirr(context.totalLifetimePayoutsSantim)}</strong>
                      </span>
                      <span className={styles.contextItem}>
                        Account since: <strong>{formatDate(context.accountCreatedAt)}</strong>
                      </span>
                      <span className={styles.contextItem}>
                        Pending moderation flags: <strong>{context.pendingModerationFlags}</strong>
                      </span>
                    </>
                  )}
                </div>
              )}

              {rejectingId === item.id && (
                <div className={styles.rejectForm}>
                  <input
                    type="text"
                    className={styles.rejectInput}
                    placeholder="Reason for rejecting (required, shown to the creator)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.denyButton}
                    disabled={pendingId === item.id || !rejectReason.trim()}
                    onClick={() => reject(item.id)}
                  >
                    {pendingId === item.id ? "Rejecting..." : "Confirm reject"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
