"use client";

import { formatSantimAsBirr, payoutResponseSchema, type PayoutMethod } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./BalanceCard.module.css";

export function BalanceCard({
  balanceSantim,
  weeklyDeltaSantim,
}: {
  balanceSantim: number;
  weeklyDeltaSantim: number;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("telebirr");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const deltaClass =
    weeklyDeltaSantim > 0 ? styles.deltaPositive : weeklyDeltaSantim < 0 ? styles.deltaNegative : styles.deltaNeutral;
  const deltaSign = weeklyDeltaSantim > 0 ? "+" : "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch("/api/backend/wallet/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountSantim: Number(amount), method, destination }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to request withdrawal");
      const payout = payoutResponseSchema.parse(data);
      setSuccess(
        payout.requiresManualApproval
          ? "Withdrawal submitted — large amounts require manual review before payout."
          : "Withdrawal submitted and is processing."
      );
      setShowForm(false);
      setAmount("");
      setDestination("");
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

      {showForm && (
        <form className={styles.form} onSubmit={handleSubmit}>
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
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="withdraw-method">
              Method
            </label>
            <select
              id="withdraw-method"
              className={styles.select}
              value={method}
              onChange={(e) => setMethod(e.target.value as PayoutMethod)}
            >
              <option value="telebirr">Telebirr</option>
              <option value="bank">Bank account</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="withdraw-destination">
              {method === "telebirr" ? "Telebirr phone number" : "Bank account number"}
            </label>
            <input
              id="withdraw-destination"
              type="text"
              required
              className={styles.input}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
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
