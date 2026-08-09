"use client";

import type { Vod } from "@habeshalive/shared";
import { useState } from "react";
import styles from "./VodManager.module.css";

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Creator Dashboard's Content page — Twitch's "Video Producer" equivalent.
// Unlike StreamEndedPrompt (a one-time nudge for freshly-recorded drafts,
// filtered to !isPublished and dismissible), this is the full persistent
// list — every VOD a creator has, published or not, with the same
// publish/unpublish/delete actions available at any time, not just right
// after a stream ends.
export function VodManager({ vods: initialVods }: { vods: Vod[] }) {
  const [vods, setVods] = useState(initialVods);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  async function publish(id: string) {
    setBusyId(id);
    setErrorById((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch(`/api/backend/vods/${id}/publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to publish");
      setVods((prev) => prev.map((v) => (v.id === id ? { ...v, isPublished: true } : v)));
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
      const res = await fetch(`/api/backend/vods/${id}/unpublish`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to unpublish");
      setVods((prev) => prev.map((v) => (v.id === id ? { ...v, isPublished: false } : v)));
    } catch (err) {
      setErrorById((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this VOD? This can't be undone.")) return;
    setBusyId(id);
    setErrorById((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch(`/api/backend/vods/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to delete");
      setVods((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      setErrorById((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusyId(null);
    }
  }

  if (vods.length === 0) {
    return <p className={styles.empty}>No VODs yet — they show up here automatically after you go live.</p>;
  }

  return (
    <div className={styles.list}>
      {vods.map((vod) => (
        <div key={vod.id} className={styles.row}>
          {vod.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vod.thumbnailUrl} alt="" className={styles.thumb} />
          ) : (
            <div className={styles.thumbPlaceholder} />
          )}
          <div className={styles.info}>
            <p className={styles.title}>{vod.title}</p>
            <p className={styles.meta}>
              {formatDuration(vod.durationSeconds)} · {vod.views} views ·{" "}
              {new Date(vod.createdAt).toLocaleDateString()}
              {vod.category && ` · ${vod.category}`}
            </p>
            {errorById[vod.id] && <p className={styles.error}>{errorById[vod.id]}</p>}
          </div>
          <span className={vod.isPublished ? styles.badgePublished : styles.badgeDraft}>
            {vod.isPublished ? "Published" : "Draft"}
          </span>
          <div className={styles.actions}>
            {vod.isPublished ? (
              <button type="button" className={styles.secondaryButton} onClick={() => unpublish(vod.id)} disabled={busyId === vod.id}>
                Unpublish
              </button>
            ) : (
              <button type="button" className={styles.publishButton} onClick={() => publish(vod.id)} disabled={busyId === vod.id}>
                Publish
              </button>
            )}
            <button type="button" className={styles.deleteButton} onClick={() => remove(vod.id)} disabled={busyId === vod.id}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
