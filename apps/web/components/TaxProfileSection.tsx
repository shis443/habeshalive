"use client";

import type { TaxFormType, TaxProfile, TaxResidency } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./AccountSection.module.css";

const RESIDENCY_LABEL: Record<TaxResidency, string> = {
  et_resident: "Resident of Ethiopia",
  diaspora: "Ethiopian diaspora",
  other: "Other / foreign resident",
};

export function TaxProfileSection({ initial }: { initial: TaxProfile | null }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [residency, setResidency] = useState<TaxResidency>("et_resident");
  const [tin, setTin] = useState("");
  const [formType, setFormType] = useState<TaxFormType>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/wallet/tax-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residency,
          ...(tin ? { tin } : {}),
          ...(residency !== "et_resident" ? { formType } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit tax profile");
      setProfile(data.data as TaxProfile);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const showForm = !profile || profile.status === "rejected";

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Tax profile</h2>

      {profile && profile.status !== "rejected" && (
        <p className={styles.currentValue}>
          {RESIDENCY_LABEL[profile.residency]} —{" "}
          {profile.status === "verified" ? "verified" : "awaiting review"}
        </p>
      )}
      {profile?.status === "rejected" && (
        <p className={styles.error}>Your last submission wasn&apos;t approved. You can submit again below.</p>
      )}

      {showForm && (
        <>
          <p className={styles.hint}>
            Required before you can be included in a payout batch — tells us how to handle any withholding on your
            earnings.
          </p>
          <form onSubmit={submit}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="tax-residency">
                Residency
              </label>
              <select
                id="tax-residency"
                className={styles.select}
                value={residency}
                onChange={(e) => setResidency(e.target.value as TaxResidency)}
              >
                <option value="et_resident">Resident of Ethiopia</option>
                <option value="diaspora">Ethiopian diaspora</option>
                <option value="other">Other / foreign resident</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="tax-tin">
                TIN (optional)
              </label>
              <input
                id="tax-tin"
                type="text"
                className={styles.input}
                value={tin}
                onChange={(e) => setTin(e.target.value)}
                maxLength={20}
              />
            </div>
            {residency !== "et_resident" && (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="tax-form-type">
                  Withholding form
                </label>
                <select
                  id="tax-form-type"
                  className={styles.select}
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as TaxFormType)}
                >
                  <option value="none">None on file yet</option>
                  <option value="w8ben">W-8BEN</option>
                  <option value="w9">W-9</option>
                </select>
              </div>
            )}
            <button type="submit" className={styles.button} disabled={busy}>
              {busy ? "Submitting…" : "Submit for review"}
            </button>
          </form>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
