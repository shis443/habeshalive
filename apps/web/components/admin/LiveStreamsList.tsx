"use client";

import type { LiveStream } from "@birq/shared";
import { useEffect, useRef, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./AdminQueue.module.css";
import liveStyles from "./LiveStreamsList.module.css";

const POLL_INTERVAL_MS = 10_000;

export function LiveStreamsList({ initialStreams }: { initialStreams: LiveStream[] }) {
  const [streams, setStreams] = useState(initialStreams);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Streams whose kill was recorded but NOT confirmed by the media server.
  // Kept distinct from a plain error: the request is durable and a
  // reconciler will retry it, so the honest label is "requested", not
  // "failed" and certainly not "ended".
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/backend/admin/streams/live");
      if (res.ok) setStreams(await unwrapClientData<LiveStream[]>(res));
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
      if (!res.ok) {
        // 502 specifically means: recorded, publisher not confirmed dropped.
        // The row deliberately stays in the list — the broadcast may still
        // be running, and removing it would repeat the exact lie this fix
        // exists to remove.
        if (res.status === 502) {
          setRequested((prev) => new Set(prev).add(id));
          setConfirmId(null);
          setReason("");
          setError(
            data.error ??
              "Kill requested but not confirmed by the media server. The stream may still be broadcasting; it will be retried."
          );
          return;
        }
        throw new Error(data.error ?? "Failed to end stream");
      }
      setRequested((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
                {requested.has(stream.id) && (
                  <span className={liveStyles.requestedBadge}>
                    End requested — not confirmed
                  </span>
                )}
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
