"use client";

import type { PayoutInstrument } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./AccountSection.module.css";

const STATUS_LABEL: Record<PayoutInstrument["status"], string> = {
  unverified: "Awaiting review",
  verified: "Verified",
  failed: "Rejected",
  retired: "Retired",
};

function coolingOffUntil(instrument: PayoutInstrument): string | null {
  if (instrument.status !== "verified") return null;
  const usableFrom = new Date(instrument.usableFrom);
  if (usableFrom.getTime() <= Date.now()) return null;
  return usableFrom.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function PayoutInstrumentSection({ initial }: { initial: PayoutInstrument[] }) {
  const router = useRouter();
  const [instruments, setInstruments] = useState(initial);
  const [method, setMethod] = useState<"telebirr" | "bank">("telebirr");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);

  const hasUsable = instruments.some((i) => i.status === "unverified" || i.status === "verified");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/wallet/payout-instruments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          accountNumber,
          accountHolder,
          ...(method === "bank" ? { bankCode } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add payout method");
      setInstruments((prev) => [data.data as PayoutInstrument, ...prev]);
      setAccountNumber("");
      setAccountHolder("");
      setBankCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function retire(id: string) {
    setRetiringId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/wallet/payout-instruments/${id}/retire`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to retire payout method");
      setInstruments((prev) => prev.map((i) => (i.id === id ? { ...i, status: "retired" } : i)));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRetiringId(null);
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Payout method</h2>

      {instruments.length > 0 && (
        <div style={{ marginBottom: "var(--space-3)" }}>
          {instruments.map((instrument) => {
            const coolingOff = coolingOffUntil(instrument);
            return (
              <div key={instrument.id} className={styles.row} style={{ marginBottom: "var(--space-2)" }}>
                <span className={styles.currentValue} style={{ margin: 0, flex: 1 }}>
                  {instrument.method === "telebirr" ? "Telebirr" : "Bank"} ····{instrument.displayTail} —{" "}
                  {STATUS_LABEL[instrument.status]}
                  {coolingOff && (
                    <span className={styles.pendingNote}> · usable from {coolingOff}</span>
                  )}
                </span>
                {(instrument.status === "unverified" || instrument.status === "verified") && (
                  <button
                    type="button"
                    className={styles.buttonDanger}
                    disabled={retiringId === instrument.id}
                    onClick={() => retire(instrument.id)}
                  >
                    {retiringId === instrument.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!hasUsable && (
        <>
          <p className={styles.hint}>
            Where your payouts are sent. A new payout method needs admin verification and a 72-hour security hold
            before it can receive money — we only ever store the last 4 digits, never the full account number.
          </p>
          <form onSubmit={submit}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="instrument-method">
                Method
              </label>
              <select
                id="instrument-method"
                className={styles.select}
                value={method}
                onChange={(e) => setMethod(e.target.value as "telebirr" | "bank")}
              >
                <option value="telebirr">Telebirr</option>
                <option value="bank">Bank account</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="instrument-account-holder">
                Account holder name
              </label>
              <input
                id="instrument-account-holder"
                type="text"
                className={styles.input}
                value={accountHolder}
                onChange={(e) => setAccountHolder(e.target.value)}
                required
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="instrument-account-number">
                {method === "telebirr" ? "Telebirr phone number" : "Account number"}
              </label>
              <input
                id="instrument-account-number"
                type="text"
                className={styles.input}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                minLength={4}
                required
              />
            </div>
            {method === "bank" && (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="instrument-bank-code">
                  Bank code
                </label>
                <input
                  id="instrument-bank-code"
                  type="text"
                  className={styles.input}
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  required
                />
                <p className={styles.hint}>Your bank&apos;s Chapa transfer code — check with support if unsure.</p>
              </div>
            )}
            <button type="submit" className={styles.button} disabled={busy || !accountNumber || !accountHolder}>
              {busy ? "Saving…" : "Add payout method"}
            </button>
          </form>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
