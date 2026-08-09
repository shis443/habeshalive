"use client";

import type { LiveStream } from "@birq/shared";
import { useEffect, useRef, useState } from "react";
import styles from "./AdminQueue.module.css";
import liveStyles from "./LiveStreamsList.module.css";

const POLL_INTERVAL_MS = 10_000;

export function LiveStreamsList({ initialStreams }: { initialStreams: LiveStream[] }) {
  const [streams, setStreams] = useState(initialStreams);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/backend/admin/streams/live");
      if (res.ok) setStreams(await res.json());
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function forceEnd(id: string) {
    if (!reason.trim()) return;
    setEndingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/streams/${id}/force-end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to end stream");
      setStreams((prev) => prev.filter((s) => s.id !== id));
      setConfirmId(null);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setEndingId(null);
    }
  }

  if (streams.length === 0) return <p className={styles.empty}>No streams are currently live.</p>;

  return (
    <div>
      <div className={styles.list}>
        {streams.map((stream) => (
          <div key={stream.id} className={styles.rowStack}>
            <div className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {stream.title} — @{stream.creator.username}
                </span>
                <span className={styles.rowMeta}>
                  {stream.category ?? "Uncategorized"} · {stream.viewerCount} viewers
                  {stream.isSensitive ? " · Sensitive" : ""}
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={liveStyles.forceEndButton}
                  onClick={() => setConfirmId(confirmId === stream.id ? null : stream.id)}
                >
                  Force-end
                </button>
              </div>
            </div>
            {confirmId === stream.id && (
              <div className={liveStyles.confirm}>
                <p className={liveStyles.confirmWarning}>
                  This immediately cuts the stream off, before any moderation queue review. Requires a reason.
                </p>
                <div className={styles.rejectForm}>
                  <input
                    type="text"
                    className={styles.rejectInput}
                    placeholder="Reason (required)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button
                    type="button"
                    className={liveStyles.confirmButton}
                    disabled={endingId === stream.id || !reason.trim()}
                    onClick={() => forceEnd(stream.id)}
                  >
                    {endingId === stream.id ? "Ending..." : "Confirm force-end"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
