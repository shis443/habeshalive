"use client";

import type { KycIdType, KycStatus } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./AccountSection.module.css";

export function KycSection({ initial }: { initial: KycStatus | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<KycStatus | null>(initial);
  const [idType, setIdType] = useState<KycIdType>("fayda");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("idType", idType);
      formData.append("document", file);
      const res = await fetch("/api/backend/kyc/submit", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      setStatus({ status: "pending", idType, rejectionReason: null, submittedAt: new Date().toISOString() });
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const current = status?.status ?? "not_submitted";

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Identity verification (KYC)</h2>

      {current === "approved" && <p className={styles.currentValue}>Verified — you&apos;re all set for payouts.</p>}

      {current === "pending" && (
        <p className={styles.currentValue}>
          Submitted {status?.submittedAt ? new Date(status.submittedAt).toLocaleDateString() : ""} — awaiting
          review.
        </p>
      )}

      {(current === "not_submitted" || current === "rejected") && (
        <>
          {current === "rejected" && (
            <p className={styles.error}>
              Your last submission wasn&apos;t approved{status?.rejectionReason ? `: ${status.rejectionReason}` : "."}{" "}
              You can submit again below.
            </p>
          )}
          <p className={styles.hint}>
            Upload a clear photo or scan of your Fayda Digital ID or Kebele ID. Required before payouts can be
            enabled on your account.
          </p>
          <form onSubmit={submit}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="kyc-id-type">
                ID type
              </label>
              <select
                id="kyc-id-type"
                className={styles.select}
                value={idType}
                onChange={(e) => setIdType(e.target.value as KycIdType)}
              >
                <option value="fayda">Fayda Digital ID</option>
                <option value="kebele">Kebele ID</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="kyc-file">
                ID photo or scan (JPEG, PNG, or PDF — max 10MB)
              </label>
              <input
                id="kyc-file"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <button type="submit" className={styles.button} disabled={busy || !file}>
              {busy ? "Uploading…" : "Submit for review"}
            </button>
          </form>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
