"use client";

import { topupResponseSchema } from "@birq/shared";
import { useState, type FormEvent, type ReactNode } from "react";
import { unwrapClientData } from "@/lib/clientApi";
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
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start top-up");
      }
      const data = await unwrapClientData<{ checkoutUrl: string }>(res);
      const { checkoutUrl } = topupResponseSchema.parse(data);
      // Chapa's hosted checkout page handles the actual payment (Telebirr/CBE
      // Birr/HelloCash method selection happens there, not here) and calls
      // our webhook on success — nothing left to do client-side after this
      // beyond leaving the page. A full navigation, not client routing: the
      // destination is a different origin entirely.
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
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
              {loading ? "Redirecting to checkout..." : `Continue with ${name}`}
            </button>
          </form>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
    </div>
  );
}
