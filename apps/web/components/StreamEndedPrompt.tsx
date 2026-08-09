"use client";

import { STREAM_CATEGORIES, type Vod } from "@birq/shared";
import { useState } from "react";
import styles from "./StreamEndedPrompt.module.css";

// Drafts are passed in already filtered to !isPublished (see
// dashboard/page.tsx) — every VOD created by the SRS on_dvr webhook
// (vods/service.ts's createVodFromRecording) starts as a draft
// (db/migrations/0028_vod_publish_workflow.sql's is_published default),
// so this is what actually surfaces that to the creator instead of it
// silently sitting unpublished forever. Not a live "your stream just
// ended" push notification — there's no event mechanism for that in this
// app — this shows on the next dashboard load instead, which is when a
// creator would naturally check in after streaming anyway.
export function StreamEndedPrompt({ drafts: initialDrafts }: { drafts: Vod[] }) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [categoryById, setCategoryById] = useState<Record<string, string>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  const visible = drafts.filter((d) => !dismissed.has(d.id));
  if (visible.length === 0) return null;

  async function publish(vod: Vod) {
    setBusyId(vod.id);
    setErrorById((e) => ({ ...e, [vod.id]: "" }));
    try {
      const category = categoryById[vod.id];
      const res = await fetch(`/api/backend/vods/${vod.id}/publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(category ? { category } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to publish");
      }
      setDrafts((ds) => ds.filter((d) => d.id !== vod.id));
    } catch (err) {
      setErrorById((e) => ({ ...e, [vod.id]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRecording(vod: Vod) {
    if (!window.confirm(`Delete this recording? This can't be undone.`)) return;
    setBusyId(vod.id);
    setErrorById((e) => ({ ...e, [vod.id]: "" }));
    try {
      const res = await fetch(`/api/backend/vods/${vod.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete");
      }
      setDrafts((ds) => ds.filter((d) => d.id !== vod.id));
    } catch (err) {
      setErrorById((e) => ({ ...e, [vod.id]: err instanceof Error ? err.message : "Something went wrong" }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.wrap}>
      {visible.map((vod) => (
        <div key={vod.id} className={styles.card}>
          <div className={styles.header}>
            <h3 className={styles.title}>Stream ended</h3>
            <p className={styles.subtitle}>
              Publish “{vod.title}” ({new Date(vod.createdAt).toLocaleString()}) to your channel and Explore?
            </p>
          </div>

          <label className={styles.categoryLabel}>
            Category
            <select
              className={styles.categorySelect}
              value={categoryById[vod.id] ?? vod.category ?? ""}
              onChange={(e) => setCategoryById((c) => ({ ...c, [vod.id]: e.target.value }))}
              disabled={busyId === vod.id}
            >
              <option value="">No category</option>
              {STREAM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {errorById[vod.id] && <p className={styles.error}>{errorById[vod.id]}</p>}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.publishButton}
              onClick={() => publish(vod)}
              disabled={busyId === vod.id}
            >
              {busyId === vod.id ? "Publishing…" : "Publish Now"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setDismissed((d) => new Set(d).add(vod.id))}
              disabled={busyId === vod.id}
            >
              Keep Draft
            </button>
            <button
              type="button"
              className={styles.deleteButton}
              onClick={() => deleteRecording(vod)}
              disabled={busyId === vod.id}
            >
              Delete Recording
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
