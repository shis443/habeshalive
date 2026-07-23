"use client";

import { streamDetailSchema } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./GoLiveButton.module.css";

export function GoLiveButton({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <button type="button" className={styles.button} onClick={handleGoLive} disabled={loading}>
        {loading ? "Starting..." : "Go live"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
