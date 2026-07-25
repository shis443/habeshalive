"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./EndStreamButton.module.css";

// Shown on a creator's own watch page (see watch/[username]/page.tsx, which
// only renders this when the logged-in viewer is the stream's creator).
// Reuses the same POST /streams/end endpoint the dashboard's GoLiveButton
// uses when live.
export function EndStreamButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/streams/end", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to end stream");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.button} onClick={handleClick} disabled={loading}>
        {loading ? "Ending..." : "End stream"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
