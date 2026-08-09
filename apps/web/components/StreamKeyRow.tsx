"use client";

import { streamKeySchema } from "@birq/shared";
import { useState } from "react";
import styles from "./StreamSetupPanel.module.css";

export function StreamKeyRow({ initialStreamKey }: { initialStreamKey: string }) {
  const [streamKey, setStreamKey] = useState(initialStreamKey);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  const masked = "•".repeat(Math.min(streamKey.length, 24));

  async function handleCopy() {
    await navigator.clipboard.writeText(streamKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRotate() {
    if (!window.confirm("Rotate your stream key? OBS will need the new key to keep streaming.")) return;
    setRotating(true);
    try {
      const res = await fetch("/api/backend/streams/key/rotate", { method: "POST" });
      if (res.ok) {
        const data = streamKeySchema.parse(await res.json());
        setStreamKey(data.streamKey);
        setRevealed(true);
      }
    } finally {
      setRotating(false);
    }
  }

  return (
    <div>
      <div className={styles.keyRow}>
        <code className={styles.keyValue}>{revealed ? streamKey : masked}</code>
        <button type="button" className={styles.smallButton} onClick={() => setRevealed((r) => !r)}>
          {revealed ? "Hide" : "Show"}
        </button>
        <button type="button" className={styles.smallButton} onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <button type="button" className={styles.rotateButton} onClick={handleRotate} disabled={rotating}>
        {rotating ? "Rotating..." : "Rotate key"}
      </button>
    </div>
  );
}
