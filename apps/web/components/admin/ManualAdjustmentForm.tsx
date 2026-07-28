"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./AdminQueue.module.css";
import filterStyles from "./PayoutHistoryFilters.module.css";
import formStyles from "./ManualAdjustmentForm.module.css";

export function ManualAdjustmentForm() {
  const router = useRouter();
  const [targetUsername, setTargetUsername] = useState("");
  const [amountBirr, setAmountBirr] = useState("");
  const [direction, setDirection] = useState<"credit_user" | "debit_user">("credit_user");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const amountSantim = Math.round(parseFloat(amountBirr || "0") * 100);
  const canSubmit = targetUsername.trim() && amountSantim > 0 && reason.trim();

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backend/admin/ledger/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUsername: targetUsername.trim(), amountSantim, direction, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit adjustment");
      setMessage({ text: "Adjustment applied.", isError: false });
      setTargetUsername("");
      setAmountBirr("");
      setReason("");
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Something went wrong", isError: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={formStyles.form}>
      <p className={formStyles.warning}>
        Rare and heavily logged — never a direct balance edit, always a real paired ledger transaction. Use this only
        for genuine corrections or refunds.
      </p>
      <input
        type="text"
        className={filterStyles.input}
        placeholder="Target username"
        value={targetUsername}
        onChange={(e) => setTargetUsername(e.target.value)}
      />
      <div className={formStyles.row}>
        <input
          type="number"
          step="0.01"
          className={filterStyles.input}
          placeholder="Amount (ETB)"
          value={amountBirr}
          onChange={(e) => setAmountBirr(e.target.value)}
        />
        <select
          className={filterStyles.select}
          value={direction}
          onChange={(e) => setDirection(e.target.value as "credit_user" | "debit_user")}
        >
          <option value="credit_user">Credit user (from platform)</option>
          <option value="debit_user">Debit user (to platform)</option>
        </select>
      </div>
      <input
        type="text"
        className={filterStyles.input}
        placeholder="Reason (required, logged)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      {!confirming ? (
        <button
          type="button"
          className={styles.denyButton}
          disabled={!canSubmit}
          onClick={() => setConfirming(true)}
        >
          Review adjustment
        </button>
      ) : (
        <div className={formStyles.confirmBox}>
          <p>
            {direction === "credit_user" ? "Credit" : "Debit"} @{targetUsername} by{" "}
            {(amountSantim / 100).toFixed(2)} ETB. Confirm?
          </p>
          <div className={formStyles.row}>
            <button type="button" className={styles.approveButton} disabled={submitting} onClick={submit}>
              {submitting ? "Submitting..." : "Confirm adjustment"}
            </button>
            <button type="button" className={styles.denyButton} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p className={message.isError ? styles.error : formStyles.success}>{message.text}</p>}
    </div>
  );
}
