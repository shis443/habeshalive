"use client";

import { topupResponseSchema } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { API_BASE_URL } from "@/lib/config";
import styles from "./AddFundsRow.module.css";

export function AddFundsRow({
  name,
  description,
  icon,
}: {
  name: string;
  description: string;
  icon: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{ reference: string; checkoutUrl: string } | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleInitiate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/backend/wallet/topups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountSantim: Number(amount) * 100 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start top-up");
      setCheckout(topupResponseSchema.parse(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Dev-only affordance: in production this step happens on Chapa's hosted
  // checkout page, which calls our webhook when the payment succeeds. There's
  // no real Chapa account wired up yet, so this simulates that callback directly.
  async function handleSimulate() {
    if (!checkout) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/wallet/webhooks/chapa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_ref: checkout.reference,
          status: "success",
          amount: Number(amount),
          currency: "ETB",
        }),
      });
      if (!res.ok) throw new Error("Simulated payment failed");
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.row}>
      <button type="button" className={styles.header} onClick={() => setOpen((o) => !o)}>
        <span className={styles.iconWrap}>{icon}</span>
        <span className={styles.textWrap}>
          <span className={styles.name}>{name}</span>
          <span className={styles.description}>{description}</span>
        </span>
      </button>

      {open && (
        <div className={styles.form}>
          {!checkout ? (
            <form onSubmit={handleInitiate}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`amount-${name}`}>
                  Amount (birr)
                </label>
                <input
                  id={`amount-${name}`}
                  type="number"
                  min="1"
                  step="1"
                  required
                  className={styles.input}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <button type="submit" className={styles.submitButton} disabled={loading}>
                {loading ? "Starting..." : `Continue with ${name}`}
              </button>
            </form>
          ) : (
            <div className={styles.checkoutBox}>
              <span className={styles.checkoutLabel}>Dev checkout simulation</span>
              <p className={styles.checkoutText}>
                In production you&apos;d be redirected to Chapa&apos;s hosted checkout now. Reference:{" "}
                {checkout.reference}
              </p>
              {!success ? (
                <button type="button" className={styles.simulateButton} onClick={handleSimulate} disabled={loading}>
                  {loading ? "Confirming..." : "Simulate successful payment"}
                </button>
              ) : (
                <p className={styles.success}>Payment confirmed — balance updated.</p>
              )}
            </div>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </div>
  );
}
