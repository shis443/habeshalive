"use client";

import { useState } from "react";
import styles from "./CreatorApplicationForm.module.css";

export function AdLeadForm() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/ads/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, contactName, contactEmail, message: message || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit inquiry");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return <div className={styles.statusBox}>Thanks — the Birq team will follow up at {contactEmail}.</div>;
  }

  return (
    <div className={styles.form}>
      <label className={styles.fieldLabel}>Company name</label>
      <input className={styles.input} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      <label className={styles.fieldLabel}>Your name</label>
      <input className={styles.input} value={contactName} onChange={(e) => setContactName(e.target.value)} />
      <label className={styles.fieldLabel}>Email</label>
      <input
        type="email"
        className={styles.input}
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
      />
      <label className={styles.fieldLabel}>What are you looking to advertise? (optional)</label>
      <textarea className={styles.textarea} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
      <button
        type="button"
        className={styles.submitButton}
        disabled={submitting || !companyName || !contactName || !contactEmail}
        onClick={submit}
      >
        {submitting ? "Sending..." : "Send inquiry"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
