"use client";

import type { AdminLiveStream } from "@birq/shared";
import { useEffect, useRef, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./AdminQueue.module.css";
import liveStyles from "./LiveStreamsList.module.css";

const POLL_INTERVAL_MS = 10_000;

type ActionKind = "force-end" | "mute-chat" | "unmute-chat" | "revoke-ingest";

const ACTION_LABEL: Record<ActionKind, string> = {
  "force-end": "Force-end",
  "mute-chat": "Mute chat",
  "unmute-chat": "Unmute chat",
  "revoke-ingest": "Revoke ingest key",
};

// What each action warns about before a moderator commits to it — kept
// beside the label above rather than inline in the confirm panel, since
// both are keyed the same way and drift apart easily otherwise.
const ACTION_WARNING: Record<ActionKind, string> = {
  "force-end": "This immediately cuts the stream off, before any moderation queue review.",
  "mute-chat": "Viewers can still watch; nobody can send a chat message until this is undone.",
  "unmute-chat": "Chat becomes sendable again immediately.",
  "revoke-ingest": "Rotates the creator's stream key. Their current broadcast will drop; they must reconfigure their encoder to go live again.",
};

export function LiveStreamsList({ initialStreams }: { initialStreams: AdminLiveStream[] }) {
  const [streams, setStreams] = useState(initialStreams);
  const [pending, setPending] = useState<{ id: string; kind: ActionKind } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: ActionKind } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/backend/admin/streams/live");
      if (res.ok) setStreams(await unwrapClientData<AdminLiveStream[]>(res));
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function runAction(id: string, kind: ActionKind) {
    if (!reason.trim()) return;
    setPending({ id, kind });
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/streams/${id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 502 is force-end specific: recorded, publisher not confirmed
        // dropped. The row deliberately stays in the list either way — the
        // next poll re-fetches real state from stream_controls rather than
        // this component guessing at it, which is what makes the
        // requested-vs-enforced badge below survive a poll instead of
        // vanishing the way an earlier, client-side-only version of this
        // did.
        setError(
          res.status === 502
            ? (data.error ?? "Kill requested but not confirmed by the media server. It will be retried.")
            : (data.error ?? `Failed to ${ACTION_LABEL[kind].toLowerCase()}`)
        );
        return;
      }
      setConfirm(null);
      setReason("");
      // Re-fetch immediately rather than waiting up to POLL_INTERVAL_MS —
      // a moderator who just muted chat should see it reflected now, not
      // up to 10s later.
      const refreshed = await fetch("/api/backend/admin/streams/live");
      if (refreshed.ok) setStreams(await unwrapClientData<AdminLiveStream[]>(refreshed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(null);
    }
  }

  if (streams.length === 0) return <p className={styles.empty}>No streams are currently live.</p>;

  return (
    <div>
      <div className={styles.list}>
        {streams.map((stream) => {
          const controls = stream.controls;
          const killRequested = controls?.killed && !controls.enforcedAt;
          return (
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
                  {/* Persistent, sourced from stream_controls on every poll —
                      not a client-side flag that a later poll's "the stream
                      already ended" response would erase along with the row. */}
                  {killRequested && (
                    <span className={liveStyles.requestedBadge}>
                      End requested — not confirmed{controls!.attempts > 1 ? ` (retried ${controls!.attempts}×)` : ""}
                    </span>
                  )}
                  {controls?.chatMuted && <span className={liveStyles.mutedBadge}>Chat muted</span>}
                  {controls?.ingestRevoked && <span className={liveStyles.mutedBadge}>Ingest key revoked</span>}
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={liveStyles.forceEndButton}
                    onClick={() => setConfirm(confirm?.id === stream.id ? null : { id: stream.id, kind: "force-end" })}
                  >
                    Force-end
                  </button>
                  <button
                    type="button"
                    className={liveStyles.secondaryButton}
                    onClick={() =>
                      setConfirm(
                        confirm?.id === stream.id
                          ? null
                          : { id: stream.id, kind: controls?.chatMuted ? "unmute-chat" : "mute-chat" }
                      )
                    }
                  >
                    {controls?.chatMuted ? "Unmute chat" : "Mute chat"}
                  </button>
                  <button
                    type="button"
                    className={liveStyles.secondaryButton}
                    onClick={() => setConfirm(confirm?.id === stream.id ? null : { id: stream.id, kind: "revoke-ingest" })}
                  >
                    Revoke ingest key
                  </button>
                </div>
              </div>
              {confirm?.id === stream.id && (
                <div className={liveStyles.confirm}>
                  <p className={liveStyles.confirmWarning}>
                    {ACTION_WARNING[confirm.kind]} Requires a reason.
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
                      disabled={(pending?.id === stream.id && pending.kind === confirm.kind) || !reason.trim()}
                      onClick={() => runAction(stream.id, confirm.kind)}
                    >
                      {pending?.id === stream.id && pending.kind === confirm.kind
                        ? "Working..."
                        : `Confirm: ${ACTION_LABEL[confirm.kind]}`}
                    </button>
                  </div>
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
