"use client";

import type { DownloadJobStatus, EnqueueDownloadResponse } from "@birq/shared";
import { useEffect, useRef, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./DownloadButton.module.css";

type JobStatus = "idle" | "pending" | "processing" | "done" | "failed";

// Build 2c — watermarked-download background job (apps/api/src/vods/
// download-service.ts). Enqueues, then polls GET /vods/downloads/:jobId
// every 3s (the sweep that actually renders the file runs every 30s
// server-side, see server.ts's DOWNLOAD_JOB_INTERVAL_MS) until the
// ffmpeg re-encode finishes. Shared between VodManager and ClipManager —
// only the enqueue path differs between a VOD and a clip.
export function DownloadButton({ kind, id }: { kind: "vod" | "clip"; id: string }) {
  const [status, setStatus] = useState<JobStatus>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function poll(jobId: string) {
    try {
      const res = await fetch(`/api/backend/vods/downloads/${jobId}`);
      const job = await unwrapClientData<DownloadJobStatus>(res);
      if (job.status === "done") {
        setStatus("done");
        setUrl(job.downloadUrl);
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (job.status === "failed") {
        setStatus("failed");
        setError(job.errorMessage ?? "Watermarking failed");
        if (pollRef.current) clearInterval(pollRef.current);
      } else {
        setStatus(job.status);
      }
    } catch {
      setStatus("failed");
      setError("Lost track of that download — try again");
      if (pollRef.current) clearInterval(pollRef.current);
    }
  }

  async function start() {
    setStatus("pending");
    setError(null);
    setUrl(null);
    try {
      const path = kind === "vod" ? `/api/backend/vods/${id}/download` : `/api/backend/vods/clips/${id}/download`;
      const res = await fetch(path, { method: "POST" });
      const { jobId } = await unwrapClientData<EnqueueDownloadResponse>(res);
      pollRef.current = setInterval(() => poll(jobId), 3000);
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  if (status === "done" && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={styles.readyLink}>
        Download ready
      </a>
    );
  }

  if (status === "pending" || status === "processing") {
    return (
      <span className={styles.pending}>
        {status === "processing" ? "Watermarking…" : "Queued…"}
      </span>
    );
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.button} onClick={start}>
        Download
      </button>
      {status === "failed" && error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
