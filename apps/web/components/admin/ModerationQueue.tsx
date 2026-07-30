"use client";

import type { ModerationFlag } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

export function ModerationQueue({ items }: { items: ModerationFlag[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string, action: "approve" | "remove") {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/moderation/queue/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to resolve flag");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No flagged content awaiting review.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>
                {item.contentType === "stream_title"
                  ? "Stream title"
                  : item.contentType === "chat_message"
                    ? "Chat message"
                    : item.contentType === "stream_thumbnail"
                      ? "Stream thumbnail"
                      : "Gift message"}{" "}
                by @{item.authorUsername}
              </span>
              {item.contentType === "stream_thumbnail" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data: URI, next/image can't optimize it anyway
                <img src={item.textSnapshot} alt="Flagged thumbnail" className={styles.flaggedThumbnail} />
              ) : (
                <span className={styles.rowDetail}>&ldquo;{item.textSnapshot}&rdquo;</span>
              )}
              <div className={styles.terms}>
                {item.matchedTerms.map((term) => (
                  <span key={term} className={styles.term}>
                    {term}
                  </span>
                ))}
              </div>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.denyButton}
                disabled={pendingId === item.id}
                onClick={() => resolve(item.id, "approve")}
              >
                Approve
              </button>
              <button
                type="button"
                className={styles.approveButton}
                disabled={pendingId === item.id}
                onClick={() => resolve(item.id, "remove")}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
