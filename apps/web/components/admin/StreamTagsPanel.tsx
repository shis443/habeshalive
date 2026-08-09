"use client";

import type { StreamTagAdminItem } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function StreamTagsPanel({ tags }: { tags: StreamTagAdminItem[] }) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);

  async function toggleBan(tag: StreamTagAdminItem) {
    setSavingId(tag.id);
    setError(null);
    try {
      const endpoint = tag.isBanned ? "unban" : "ban";
      const res = await fetch(`/api/backend/admin/stream-tags/${tag.id}/${endpoint}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed to ${endpoint} tag`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  async function mergeInto(targetTagId: string) {
    if (!mergeSourceId || mergeSourceId === targetTagId) return;
    setSavingId(mergeSourceId);
    setError(null);
    try {
      const res = await fetch("/api/backend/admin/stream-tags/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceTagId: mergeSourceId, targetTagId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to merge tags");
      setMergeSourceId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSavingId(null);
    }
  }

  if (tags.length === 0) return <p className={styles.empty}>No stream tags yet.</p>;

  return (
    <div>
      {mergeSourceId && (
        <p className={styles.rowMeta}>
          Merging &quot;{tags.find((t) => t.id === mergeSourceId)?.name}&quot; — click &quot;Merge here&quot; on the
          tag to keep, or{" "}
          <button type="button" className={styles.denyButton} onClick={() => setMergeSourceId(null)}>
            cancel
          </button>
        </p>
      )}
      <div className={styles.list}>
        {tags.map((tag) => (
          <div key={tag.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                #{tag.name} {tag.isBanned && <span className={styles.rowMeta}>(banned)</span>}
              </span>
              <span className={styles.rowMeta}>{tag.usageCount} streams</span>
            </div>
            <div className={styles.actions}>
              {mergeSourceId && mergeSourceId !== tag.id ? (
                <button
                  type="button"
                  className={styles.approveButton}
                  disabled={savingId === mergeSourceId}
                  onClick={() => mergeInto(tag.id)}
                >
                  Merge here
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.denyButton}
                  disabled={savingId === tag.id || tag.usageCount === 0}
                  onClick={() => setMergeSourceId(tag.id)}
                >
                  Merge from
                </button>
              )}
              <button
                type="button"
                className={tag.isBanned ? styles.approveButton : styles.denyButton}
                disabled={savingId === tag.id}
                onClick={() => toggleBan(tag)}
              >
                {tag.isBanned ? "Unban" : "Ban"}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
