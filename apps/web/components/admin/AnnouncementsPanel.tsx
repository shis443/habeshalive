"use client";

import type { AnnouncementAdminItem } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import filterStyles from "./PayoutHistoryFilters.module.css";
import formStyles from "./ManualAdjustmentForm.module.css";

export function AnnouncementsPanel({ items }: { items: AnnouncementAdminItem[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          actionLabel: actionLabel || undefined,
          actionUrl: actionUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create announcement");
      setBody("");
      setActionLabel("");
      setActionUrl("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function deactivate(id: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/announcements/${id}/deactivate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to deactivate");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={formStyles.form}>
        <div className={formStyles.row}>
          <input
            className={filterStyles.input}
            placeholder="Announcement text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={280}
          />
          <input
            className={filterStyles.input}
            placeholder="Action label (optional)"
            value={actionLabel}
            onChange={(e) => setActionLabel(e.target.value)}
          />
          <input
            className={filterStyles.input}
            placeholder="Action URL (optional)"
            value={actionUrl}
            onChange={(e) => setActionUrl(e.target.value)}
          />
        </div>
        <button type="button" className={styles.approveButton} disabled={submitting || !body.trim()} onClick={submit}>
          Post announcement
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>

      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>{item.body}</span>
              <span className={styles.rowMeta}>
                {item.isActive ? "Active" : "Inactive"} · by {item.createdByUsername}
                {item.actionLabel ? ` · action: ${item.actionLabel}` : ""}
              </span>
            </div>
            {item.isActive && (
              <button type="button" className={styles.denyButton} disabled={submitting} onClick={() => deactivate(item.id)}>
                Deactivate
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
