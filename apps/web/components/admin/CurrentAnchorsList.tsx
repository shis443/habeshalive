"use client";

import { formatSantimAsBirr, type CreatorListItem } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function CurrentAnchorsList({ items }: { items: CreatorListItem[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function removeAnchor(id: string) {
    setSaving(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/creators/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAnchorCreator: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No anchor creators yet.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>@{item.username}</span>
              <span className={styles.rowMeta}>
                {formatSantimAsBirr(item.totalPayoutsSantim)} paid · {item.streamCount} streams ·{" "}
                {item.followerCount} followers · {(item.revenueShareBps / 100).toFixed(0)}% share
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.denyButton}
                disabled={saving === item.id}
                onClick={() => removeAnchor(item.id)}
              >
                Remove anchor status
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
