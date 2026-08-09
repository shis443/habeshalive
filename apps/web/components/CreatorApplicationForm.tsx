"use client";

import type { MyCreatorApplication } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./CreatorApplicationForm.module.css";

const STATUS_COPY: Record<MyCreatorApplication["status"], string> = {
  pending: "Your application is in review. We'll update this page once a decision is made.",
  approved: "Your application was approved — you can go live from your dashboard.",
  rejected: "Your application wasn't approved this round. You're welcome to apply again.",
};

export function CreatorApplicationForm({
  existing,
  capReached,
}: {
  existing: MyCreatorApplication | null;
  capReached: boolean;
}) {
  const router = useRouter();
  const [applicationText, setApplicationText] = useState("");
  const [socialLinks, setSocialLinks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/creator-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationText, socialLinks: socialLinks || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit application");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (existing && existing.status !== "rejected") {
    return (
      <div className={styles.statusBox}>
        <p className={styles.statusBadge}>{existing.status}</p>
        <p>{STATUS_COPY[existing.status]}</p>
      </div>
    );
  }

  if (capReached) {
    return (
      <div className={styles.statusBox}>
        <p>
          All spots in this launch batch are currently filled. Check back later — the team may open
          more.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.form}>
      {existing?.status === "rejected" && (
        <p className={styles.statusBox}>Your previous application wasn&apos;t approved. You can apply again below.</p>
      )}
      <label className={styles.fieldLabel}>
        Tell us about what you&apos;d stream and why (min. 20 characters)
      </label>
      <textarea
        className={styles.textarea}
        rows={5}
        value={applicationText}
        onChange={(e) => setApplicationText(e.target.value)}
        placeholder="What will you stream, how often, and what audience are you bringing?"
      />
      <label className={styles.fieldLabel}>Links to existing channels/socials (optional)</label>
      <input
        type="text"
        className={styles.input}
        value={socialLinks}
        onChange={(e) => setSocialLinks(e.target.value)}
        placeholder="YouTube, TikTok, Instagram, etc."
      />
      <button
        type="button"
        className={styles.submitButton}
        disabled={submitting || applicationText.trim().length < 20}
        onClick={submit}
      >
        {submitting ? "Submitting..." : "Submit application"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
