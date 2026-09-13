"use client";

import { formatSantimAsBirr, type PayoutBatch } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

const STATUS_LABEL: Record<PayoutBatch["status"], string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved — ready to disburse",
  processing: "Disbursing…",
  settled: "Settled",
  rejected: "Rejected",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function PayoutBatchList({ items }: { items: PayoutBatch[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function act(id: string, action: "approve" | "reject" | "disburse", body?: object) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/payout-batches/${id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed to ${action} batch`);
      setRejectingId(null);
      setRejectReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No payout batches yet.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((batch) => (
          <div key={batch.id} className={styles.rowStack}>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {batch.method} batch — {formatSantimAsBirr(batch.totalSantim)} · {batch.itemCount} creator
                  {batch.itemCount === 1 ? "" : "s"}
                </span>
                <span className={styles.rowMeta}>
                  Prepared by @{batch.preparedByUsername} on {formatDate(batch.createdAt)}
                  {batch.approvedByUsername && ` · approved by @${batch.approvedByUsername}`}
                </span>
              </div>
              <div className={styles.actions}>
                <span className={styles.rowMeta}>{STATUS_LABEL[batch.status]}</span>
                {batch.status === "pending_approval" && (
                  <>
                    <button
                      type="button"
                      className={styles.approveButton}
                      disabled={pendingId === batch.id}
                      onClick={() => act(batch.id, "approve")}
                    >
                      {pendingId === batch.id ? "Approving…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      className={styles.denyButton}
                      disabled={pendingId === batch.id}
                      onClick={() => setRejectingId(rejectingId === batch.id ? null : batch.id)}
                    >
                      Reject
                    </button>
                  </>
                )}
                {batch.status === "approved" && (
                  <button
                    type="button"
                    className={styles.approveButton}
                    disabled={pendingId === batch.id}
                    onClick={() => act(batch.id, "disburse")}
                  >
                    {pendingId === batch.id ? "Disbursing…" : "Disburse"}
                  </button>
                )}
              </div>
            </div>

            {rejectingId === batch.id && (
              <div className={styles.rejectForm}>
                <input
                  type="text"
                  className={styles.rejectInput}
                  placeholder="Reason for rejecting (required)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <button
                  type="button"
                  className={styles.denyButton}
                  disabled={pendingId === batch.id || !rejectReason.trim()}
                  onClick={() => act(batch.id, "reject", { reason: rejectReason.trim() })}
                >
                  {pendingId === batch.id ? "Rejecting…" : "Confirm reject"}
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
