"use client";

import type { AccountDeletionStatus } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AccountSection.module.css";

// E.8: re-authentication (password, or an OTP for password-less
// accounts) plus the server-side blockers (positive balance, pending
// payout, active subscribers as a creator) are enforced in
// auth/account-deletion-service.ts — this form surfaces whatever it says
// rather than duplicating that logic client-side.
export function AccountDeletionSection({
  status,
  hasPassword,
}: {
  status: AccountDeletionStatus | null;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/auth/account/deletion/request-otp", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function submitDeletion() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/auth/account/deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: hasPassword ? password : undefined, code: hasPassword ? undefined : code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to request deletion");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function cancelDeletion() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/auth/account/deletion", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to cancel deletion");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (status?.deletionRequestedAt) {
    const graceEnds = status.gracePeriodEndsAt ? new Date(status.gracePeriodEndsAt).toDateString() : "soon";
    return (
      <div className={styles.card}>
        <h2 className={styles.title}>Delete account</h2>
        <p className={styles.hint}>
          Your account is scheduled for deletion on {graceEnds}. Logging in again before then
          cancels it — or cancel right now below.
        </p>
        <button type="button" className={styles.buttonSecondary} onClick={cancelDeletion} disabled={busy}>
          Cancel deletion
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Delete account</h2>
      {!confirming ? (
        <>
          <p className={styles.hint}>
            This starts a 30-day grace period before your account is permanently anonymized. You
            can&apos;t delete with a positive wallet balance, a payout in progress, or active
            subscribers as a creator.
          </p>
          <button type="button" className={styles.buttonDanger} onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        </>
      ) : (
        <>
          {hasPassword ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="delete-password">
                Confirm your password
              </label>
              <input
                id="delete-password"
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          ) : codeSent ? (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="delete-code">
                6-digit code
              </label>
              <input
                id="delete-code"
                type="text"
                className={styles.input}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
              />
            </div>
          ) : (
            <button type="button" className={styles.buttonSecondary} onClick={sendOtp} disabled={busy}>
              Send verification code
            </button>
          )}
          {(hasPassword || codeSent) && (
            <div className={styles.row}>
              <button
                type="button"
                className={styles.buttonDanger}
                onClick={submitDeletion}
                disabled={busy || (hasPassword ? !password : code.length !== 6)}
              >
                {busy ? "Submitting…" : "Confirm deletion"}
              </button>
              <button type="button" className={styles.buttonSecondary} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </>
      )}
    </div>
  );
}
