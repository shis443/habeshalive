"use client";

import { formatSantimAsBirr, payoutResponseSchema, type PayoutInstrument } from "@birq/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./BalanceCard.module.css";

// Real bug found during a live walkthrough: this form used to collect a
// raw {method, destination} pair and POST it straight to /wallet/payouts
// — the exact plaintext-account-number shape T7 (0060) removed in favor
// of a pre-bound, admin-verified payout_instrument. Every real withdrawal
// attempt from this page has been failing its own request schema since,
// even though the newer instrument-bind flow (Settings > Security) and
// the admin-side queues were both updated. Fixed by reading the same
// verified instrument PayoutInstrumentSection.tsx already manages,
// instead of asking for account details a second time here.
export function BalanceCard({
  balanceSantim,
  weeklyDeltaSantim,
  verifiedInstrument,
}: {
  balanceSantim: number;
  weeklyDeltaSantim: number;
  verifiedInstrument: PayoutInstrument | null;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const deltaClass =
    weeklyDeltaSantim > 0 ? styles.deltaPositive : weeklyDeltaSantim < 0 ? styles.deltaNegative : styles.deltaNeutral;
  const deltaSign = weeklyDeltaSantim > 0 ? "+" : "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!verifiedInstrument) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch("/api/backend/wallet/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountSantim: Number(amount), instrumentId: verifiedInstrument.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to request withdrawal");
      }
      const data = await unwrapClientData<unknown>(res);
      const payout = payoutResponseSchema.parse(data);
      setSuccess(
        payout.requiresManualApproval
          ? "Withdrawal submitted — large amounts require manual review before payout."
          : "Withdrawal submitted and is processing."
      );
      setShowForm(false);
      setAmount("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <span className={styles.label}>Available balance</span>
      <p className={styles.balance}>{formatSantimAsBirr(balanceSantim)}</p>
      <p className={`${styles.delta} ${deltaClass}`}>
        {deltaSign}
        {formatSantimAsBirr(weeklyDeltaSantim)} this week
      </p>

      {!showForm && (
        <button type="button" className={styles.withdrawButton} onClick={() => setShowForm(true)}>
          Withdraw
        </button>
      )}

      {success && <p className={styles.success}>{success}</p>}

      {showForm && !verifiedInstrument && (
        <p className={styles.error}>
          You need a verified payout method before you can withdraw.{" "}
          <Link href="/settings?tab=security">Add one in Settings</Link> — it needs admin verification and a
          72-hour security hold before it can be used.
        </p>
      )}

      {showForm && verifiedInstrument && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <p className={styles.label}>
            Paying out to: {verifiedInstrument.method === "telebirr" ? "Telebirr" : "Bank"} ····
            {verifiedInstrument.displayTail}
          </p>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="withdraw-amount">
              Amount (birr)
            </label>
            <input
              id="withdraw-amount"
              type="number"
              min="1"
              step="1"
              required
              className={styles.input}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="submit" className={styles.withdrawButton} disabled={loading}>
              {loading ? "Submitting..." : "Confirm withdrawal"}
            </button>
            <button type="button" className={styles.cancelButton} onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
