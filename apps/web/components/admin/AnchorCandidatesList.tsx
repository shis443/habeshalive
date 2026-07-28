"use client";

import { formatSantimAsBirr, type AnchorCandidate } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

function tenureDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export function AnchorCandidatesList({ items }: { items: AnchorCandidate[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markAnchor(id: string) {
    setSaving(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/creators/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAnchorCreator: true }),
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

  if (items.length === 0) return <p className={styles.empty}>No candidates with real revenue yet.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>@{item.username}</span>
              <span className={styles.rowMeta}>
                {formatSantimAsBirr(item.lifetimeEarningsSantim)} lifetime earnings · {item.streamCount} streams ·{" "}
                {item.followerCount} followers · {tenureDays(item.accountCreatedAt)}d on platform
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.approveButton}
                disabled={saving === item.id}
                onClick={() => markAnchor(item.id)}
              >
                Mark as anchor creator
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
