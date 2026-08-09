"use client";

import { useState, type FormEvent } from "react";
import { API_BASE_URL } from "@/lib/config";
import styles from "./DmcaReportForm.module.css";

export function DmcaReportForm() {
  const [reporterName, setReporterName] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [contentType, setContentType] = useState<"vod" | "clip" | "stream">("vod");
  const [contentId, setContentId] = useState("");
  const [contentUrl, setContentUrl] = useState("");
  const [description, setDescription] = useState("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [accurate, setAccurate] = useState(false);
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<"idle" | "success" | "error">("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult("idle");
    try {
      const res = await fetch(`${API_BASE_URL}/dmca/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporterName,
          reporterEmail,
          contentType,
          contentId,
          contentUrl: contentUrl || undefined,
          copyrightedWorkDescription: description,
          goodFaithStatement: goodFaith,
          accuracyStatement: accurate,
          signature,
        }),
      });
      setResult(res.ok ? "success" : "error");
    } catch {
      setResult("error");
    } finally {
      setSubmitting(false);
    }
  }

  if (result === "success") {
    return <p className={styles.success}>Your report was submitted. We&apos;ll review it and follow up by email.</p>;
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.field}>
        Your name
        <input required value={reporterName} onChange={(e) => setReporterName(e.target.value)} />
      </label>
      <label className={styles.field}>
        Your email
        <input required type="email" value={reporterEmail} onChange={(e) => setReporterEmail(e.target.value)} />
      </label>
      <label className={styles.field}>
        Content type
        <select value={contentType} onChange={(e) => setContentType(e.target.value as typeof contentType)}>
          <option value="vod">Video (VOD)</option>
          <option value="clip">Clip</option>
          <option value="stream">Live stream</option>
        </select>
      </label>
      <label className={styles.field}>
        Content ID
        <input
          required
          placeholder="Found in the content's URL on birq.live"
          value={contentId}
          onChange={(e) => setContentId(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        Content URL (optional, helps us find it faster)
        <input type="url" value={contentUrl} onChange={(e) => setContentUrl(e.target.value)} />
      </label>
      <label className={styles.field}>
        Describe the copyrighted work this infringes
        <textarea required rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className={styles.checkbox}>
        <input type="checkbox" required checked={goodFaith} onChange={(e) => setGoodFaith(e.target.checked)} />I have a
        good faith belief that use of the material in the manner complained of is not authorized by the copyright
        owner, its agent, or the law.
      </label>
      <label className={styles.checkbox}>
        <input type="checkbox" required checked={accurate} onChange={(e) => setAccurate(e.target.checked)} />
        The information in this notice is accurate, and, under penalty of perjury, I am the copyright owner or
        authorized to act on the copyright owner&apos;s behalf.
      </label>
      <label className={styles.field}>
        Electronic signature (type your full legal name)
        <input required value={signature} onChange={(e) => setSignature(e.target.value)} />
      </label>
      {result === "error" && <p className={styles.error}>Something went wrong. Please try again.</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}
