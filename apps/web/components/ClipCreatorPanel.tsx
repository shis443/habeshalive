"use client";

import { MAX_CLIP_DURATION_SECONDS, type Clip, type Vod } from "@habeshalive/shared";
import { useState } from "react";
import styles from "./ClipCreatorPanel.module.css";

function parseTimecode(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = /^(\d+):([0-5]?\d)$/.exec(trimmed);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Module 4 — creates a real clip via ffmpeg (vods/clip-service.ts), not a
// placeholder. Runs synchronously server-side (bounded by
// MAX_CLIP_DURATION_SECONDS so this stays fast enough for one HTTP
// request), so this button just shows a spinner state while it waits.
export function ClipCreatorPanel({ vods }: { vods: Vod[] }) {
  const [vodId, setVodId] = useState(vods[0]?.id ?? "");
  const [start, setStart] = useState("0:00");
  const [duration, setDuration] = useState("30");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Clip | null>(null);

  async function handleCreate() {
    const startSeconds = parseTimecode(start);
    const durationSeconds = Number(duration);
    if (startSeconds === null) {
      setError("Start time must be seconds or mm:ss");
      return;
    }
    if (!Number.isInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_CLIP_DURATION_SECONDS) {
      setError(`Duration must be 1-${MAX_CLIP_DURATION_SECONDS} seconds`);
      return;
    }

    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch(`/api/backend/vods/${vodId}/clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startSeconds, durationSeconds, title: title.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create clip");
      setCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>Create a clip</h3>
      <p className={styles.subtitle}>Crops a 9:16 vertical clip from one of your recordings — up to {MAX_CLIP_DURATION_SECONDS}s.</p>

      <div className={styles.row}>
        <label className={styles.field}>
          Source recording
          <select className={styles.select} value={vodId} onChange={(e) => setVodId(e.target.value)}>
            {vods.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} ({new Date(v.createdAt).toLocaleDateString()})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          Start (mm:ss)
          <input className={styles.input} value={start} onChange={(e) => setStart(e.target.value)} placeholder="0:00" />
        </label>
        <label className={styles.field}>
          Duration (seconds)
          <input
            className={styles.input}
            type="number"
            min={1}
            max={MAX_CLIP_DURATION_SECONDS}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
      </div>

      <label className={styles.field}>
        Title (optional)
        <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
      </label>

      {error && <p className={styles.error}>{error}</p>}
      {created && (
        <p className={styles.success}>
          Clip ready —{" "}
          <a href={created.playbackUrl} target="_blank" rel="noreferrer">
            view it
          </a>
        </p>
      )}

      <button type="button" className={styles.createButton} onClick={handleCreate} disabled={busy || !vodId}>
        {busy ? "Creating clip…" : "Create clip"}
      </button>
    </div>
  );
}
