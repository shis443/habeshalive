"use client";

import { STREAM_CATEGORIES, STREAM_LANGUAGES, type ScheduledStream } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fileToCompressedDataUrl } from "@/lib/image";
import styles from "./AccountSection.module.css";

// Creator-side counterpart to UpcomingStreamCard.tsx's audience view —
// YouTube-style "schedule a future broadcast" form. Submitting always
// replaces any existing pending schedule (see createOrReplaceScheduledStream's
// own comment) rather than a separate edit flow, since the one-pending-
// schedule-per-creator constraint (db/migrations/0066) makes "create" and
// "edit" the same operation from the API's point of view.
export function ScheduleStreamPanel({ scheduledStream }: { scheduledStream: ScheduledStream | null }) {
  const router = useRouter();
  const [title, setTitle] = useState(scheduledStream?.title ?? "");
  const [caption, setCaption] = useState(scheduledStream?.caption ?? "");
  const [category, setCategory] = useState(scheduledStream?.category ?? "");
  const [language, setLanguage] = useState(scheduledStream?.language ?? "");
  // datetime-local has no timezone of its own — the browser reads/writes
  // it in local time, and `new Date(...).toISOString()` below converts
  // using the browser's own local timezone, same as every other
  // client-authored timestamp this app sends.
  const [scheduledAt, setScheduledAt] = useState(
    scheduledStream ? new Date(scheduledStream.scheduledAt).toISOString().slice(0, 16) : ""
  );
  const [thumbnail, setThumbnail] = useState<string | null>(scheduledStream?.thumbnailUrl ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleThumbnailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setThumbnail(await fileToCompressedDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that image");
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/streams/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          caption: caption || undefined,
          category: category || undefined,
          language: language || undefined,
          scheduledAt: new Date(scheduledAt).toISOString(),
          thumbnailUrl: thumbnail ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to schedule stream");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/streams/scheduled/mine", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to cancel");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Schedule a stream</h2>

      {scheduledStream && (
        <p className={styles.currentValue}>
          Currently scheduled for {new Date(scheduledStream.scheduledAt).toLocaleString()}.
        </p>
      )}

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="schedule-title">
          Title
        </label>
        <input
          id="schedule-title"
          type="text"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="schedule-caption">
          Caption
        </label>
        <textarea
          id="schedule-caption"
          className={styles.textarea}
          rows={2}
          maxLength={500}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="schedule-category">
          Category
        </label>
        <select
          id="schedule-category"
          className={styles.select}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">None</option>
          {STREAM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="schedule-language">
          Language
        </label>
        <select
          id="schedule-language"
          className={styles.select}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="">None</option>
          {STREAM_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="schedule-time">
          Scheduled time
        </label>
        <input
          id="schedule-time"
          type="datetime-local"
          className={styles.input}
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Thumbnail</span>
        {thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" width={200} style={{ borderRadius: 6, display: "block", marginBottom: 8 }} />
        )}
        <input type="file" accept="image/*" onChange={handleThumbnailChange} />
      </div>

      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          onClick={handleSubmit}
          disabled={submitting || !title || !scheduledAt}
        >
          {scheduledStream ? "Update schedule" : "Schedule stream"}
        </button>
        {scheduledStream && (
          <button type="button" className={styles.buttonDanger} onClick={handleCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
