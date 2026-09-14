"use client";

import type { Clip } from "@birq/shared";
import { useState } from "react";
import { DownloadButton } from "./DownloadButton";
import styles from "./VodManager.module.css";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Build 2c — the clip-side twin of VodManager.tsx (same list/publish/
// unpublish/delete/download shape, reusing its CSS module rather than
// forking near-identical styles). A clip defaults published (see
// db/migrations/0068's comment — creating one is already a deliberate
// act, unlike a VOD's automatic per-stream recording), so "Unpublish"
// here is for pulling a clip out of the public profile without deleting
// it, not clearing a draft state.
export function ClipManager({ clips: initialClips }: { clips: Clip[] }) {
  const [clips, setClips] = useState(initialClips);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function publish(id: string) {
    setBusyId(id);
    setErrorById((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch(`/api/backend/vods/clips/${id}/publish`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to publish");
      setClips((prev) => prev.map((c) => (c.id === id ? { ...c, isPublished: true } : c)));
    } catch (err) {
      setErrorById((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusyId(null);
    }
  }

  async function unpublish(id: string) {
    setBusyId(id);
    setErrorById((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch(`/api/backend/vods/clips/${id}/unpublish`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to unpublish");
      setClips((prev) => prev.map((c) => (c.id === id ? { ...c, isPublished: false } : c)));
    } catch (err) {
      setErrorById((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this clip? This can't be undone.")) return;
    setBusyId(id);
    setErrorById((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch(`/api/backend/vods/clips/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete");
      setClips((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setErrorById((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusyId(null);
    }
  }

  if (clips.length === 0) {
    return <p className={styles.empty}>No clips yet — create one from a VOD above.</p>;
  }

  return (
    <div className={styles.list}>
      {clips.map((clip) => (
        <div key={clip.id} className={styles.row}>
          <div className={styles.thumbPlaceholder} />
          <div className={styles.info}>
            <p className={styles.title}>{clip.title ?? "Untitled clip"}</p>
            <p className={styles.meta}>
              {formatDuration(clip.durationSeconds)} · {new Date(clip.createdAt).toLocaleDateString()}
            </p>
            {errorById[clip.id] && <p className={styles.error}>{errorById[clip.id]}</p>}
          </div>
          <span className={clip.isPublished ? styles.badgePublished : styles.badgeDraft}>
            {clip.isPublished ? "Published" : "Unpublished"}
          </span>
          <div className={styles.actions}>
            {clip.isPublished ? (
              <button type="button" className={styles.secondaryButton} onClick={() => unpublish(clip.id)} disabled={busyId === clip.id}>
                Unpublish
              </button>
            ) : (
              <button type="button" className={styles.publishButton} onClick={() => publish(clip.id)} disabled={busyId === clip.id}>
                Publish
              </button>
            )}
            <button type="button" className={styles.deleteButton} onClick={() => remove(clip.id)} disabled={busyId === clip.id}>
              Delete
            </button>
            <DownloadButton kind="clip" id={clip.id} />
          </div>
        </div>
      ))}
    </div>
  );
}
