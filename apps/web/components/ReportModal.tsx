"use client";

import { useState } from "react";
import styles from "./ReportModal.module.css";
import { CloseIcon } from "./icons";

const REASONS = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "spam", label: "Spam" },
  { value: "nudity", label: "Nudity or sexual content" },
  { value: "other", label: "Other" },
] as const;

// D.4: one modal, two entry points. "Report Live Stream" targets the
// stream itself (its content, right now); "Report Something Else" targets
// the creator's account — the same submitReportSchema either way, see
// packages/shared/src/schemas/reports.ts. Both land in the same admin
// moderation queue (apps/web/components/admin/ReportsQueue.tsx).
export function ReportModal({
  targetType,
  targetId,
  title,
  onClose,
}: {
  targetType: "stream" | "user";
  targetId: string;
  title: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("harassment");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/moderation/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason, details: details.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit report");
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {submitted ? (
          <p className={styles.confirmation}>
            Report submitted. A moderator will review it — see the Safety Center for what happens next.
          </p>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Reason</label>
              <select
                className={styles.select}
                value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}
              >
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Details (optional)</label>
              <textarea
                className={styles.textarea}
                rows={4}
                maxLength={500}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="What happened?"
              />
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <button type="button" className={styles.submitButton} onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit report"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
