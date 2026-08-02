"use client";

import { formatSantimAsBirr, type CreatorListItem } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import creatorStyles from "./CreatorsList.module.css";

export function CreatorsList({ items }: { items: CreatorListItem[] }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [revenueShare, setRevenueShare] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [suspending, setSuspending] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleExpand(item: CreatorListItem) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    setSuspending(null);
    setRevenueShare(String(item.revenueShareBps / 100));
  }

  async function saveRevenueShare(id: string) {
    setSaving(true);
    setError(null);
    try {
      const bps = Math.round(parseFloat(revenueShare || "0") * 100);
      const res = await fetch(`/api/backend/admin/creators/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenueShareBps: bps }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAnchor(item: CreatorListItem) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/creators/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAnchorCreator: !item.isAnchorCreator }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function toggleVerified(item: CreatorListItem) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/creators/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isVerified: !item.isVerified }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function suspend(id: string) {
    if (!suspendReason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/creators/${id}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: suspendReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to suspend");
      setSuspendReason("");
      setSuspending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function unsuspend(id: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/creators/${id}/unsuspend`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to unsuspend");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No creators match this search.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.rowStack}>
            <div className={`${styles.row} ${styles.rowExpandable}`} onClick={() => toggleExpand(item)}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  @{item.username}
                  {item.isVerified && <span className={creatorStyles.anchorBadge}>Verified</span>}
                  {item.isAnchorCreator && <span className={creatorStyles.anchorBadge}>Anchor</span>}
                  {item.isSuspended && <span className={creatorStyles.suspendedBadge}>Suspended</span>}
                </span>
                <span className={styles.rowMeta}>
                  {formatSantimAsBirr(item.totalPayoutsSantim)} paid · {item.streamCount} streams ·{" "}
                  {item.followerCount} followers · {(item.revenueShareBps / 100).toFixed(0)}% share
                </span>
              </div>
            </div>

            {expandedId === item.id && (
              <div className={creatorStyles.detail} onClick={(e) => e.stopPropagation()}>
                <div className={creatorStyles.field}>
                  <label>Revenue share (%)</label>
                  <div className={creatorStyles.row}>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="100"
                      value={revenueShare}
                      onChange={(e) => setRevenueShare(e.target.value)}
                    />
                    <button type="button" className={styles.approveButton} disabled={saving} onClick={() => saveRevenueShare(item.id)}>
                      Save
                    </button>
                  </div>
                </div>
                <button type="button" className={styles.denyButton} disabled={saving} onClick={() => toggleAnchor(item)}>
                  {item.isAnchorCreator ? "Remove anchor status" : "Mark as anchor creator"}
                </button>
                <button type="button" className={styles.denyButton} disabled={saving} onClick={() => toggleVerified(item)}>
                  {item.isVerified ? "Remove verified badge" : "Grant verified badge"}
                </button>

                {item.isSuspended ? (
                  <button type="button" className={styles.approveButton} disabled={saving} onClick={() => unsuspend(item.id)}>
                    Unsuspend
                  </button>
                ) : suspending === item.id ? (
                  <div className={styles.rejectForm}>
                    <input
                      type="text"
                      className={styles.rejectInput}
                      placeholder="Suspension reason (required)"
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                    />
                    <button
                      type="button"
                      className={creatorStyles.suspendButton}
                      disabled={saving || !suspendReason.trim()}
                      onClick={() => suspend(item.id)}
                    >
                      Confirm suspend
                    </button>
                  </div>
                ) : (
                  <button type="button" className={creatorStyles.suspendButton} onClick={() => setSuspending(item.id)}>
                    Suspend (revokes streaming & payouts)
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
