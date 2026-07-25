"use client";

import { streamDetailSchema } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./GoLiveButton.module.css";

export function GoLiveButton({
  displayName,
  isLive: initialIsLive = false,
}: {
  displayName: string;
  isLive?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirrors the server-fetched initial value but updates immediately from
  // the end-stream response, rather than depending on router.refresh() to
  // re-run the dashboard's server component — that round-trip proved
  // unreliable in practice (confirmed via a real browser: the POST
  // succeeds and the DB is correctly updated, but router.refresh() alone
  // left this button showing "End stream" until a manual page reload).
  const [isLive, setIsLive] = useState(initialIsLive);

  async function handleGoLive() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/streams/go-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${displayName} is live` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to go live");
      const stream = streamDetailSchema.parse(data);
      router.push(`/watch/${stream.creator.username}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  async function handleEndStream() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/streams/end", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to end stream");
      }
      setIsLive(false);
      // Best-effort: brings the rest of the dashboard (stats, etc.) back in
      // sync too, but this button's own state no longer depends on it.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className={isLive ? `${styles.button} ${styles.buttonEnd}` : styles.button}
        onClick={isLive ? handleEndStream : handleGoLive}
        disabled={loading}
      >
        {isLive
          ? loading
            ? "Ending stream..."
            : "You're live — End stream"
          : loading
            ? "Starting..."
            : "Go live"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
