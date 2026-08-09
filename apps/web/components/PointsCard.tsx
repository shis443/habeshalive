"use client";

import { formatSantimAsBirr, POINTS_PER_SANTIM, redeemPointsResponseSchema } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./BalanceCard.module.css";

// Module 4 — Watch-to-Earn balance + redemption. Reuses BalanceCard's own
// stylesheet (same visual language, a second "balance card" on the same
// page) rather than a near-duplicate one. Redemption credits real wallet
// balance, not literal mobile airtime — see points/service.ts's own
// comment on why.
export function PointsCard({ balance }: { balance: number }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [points, setPoints] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const pointsValue = Number(points) || 0;
  const santimPreview = Math.floor(pointsValue / POINTS_PER_SANTIM);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch("/api/backend/points/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: pointsValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to redeem points");
      const result = redeemPointsResponseSchema.parse(data);
      setSuccess(`Redeemed for ${formatSantimAsBirr(result.creditedSantim)} — added to your wallet balance.`);
      setShowForm(false);
      setPoints("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <span className={styles.label}>Birq Points (Watch-to-Earn)</span>
      <p className={styles.balance}>{balance.toLocaleString()} pts</p>
      <p className={styles.delta}>Earned by watching live streams — {POINTS_PER_SANTIM} points = 1 santim.</p>

      {!showForm && balance >= POINTS_PER_SANTIM && (
        <button type="button" className={styles.withdrawButton} onClick={() => setShowForm(true)}>
          Redeem for wallet credit
        </button>
      )}

      {success && <p className={styles.success}>{success}</p>}

      {showForm && (
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="redeem-points">
              Points to redeem (max {balance.toLocaleString()})
            </label>
            <input
              id="redeem-points"
              type="number"
              min={POINTS_PER_SANTIM}
              max={balance}
              step="1"
              required
              className={styles.input}
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
            {pointsValue > 0 && (
              <p style={{ fontSize: 12, color: "var(--on-surface-variant)", margin: "4px 0 0" }}>
                ≈ {formatSantimAsBirr(santimPreview)}
              </p>
            )}
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="submit" className={styles.withdrawButton} disabled={loading || santimPreview <= 0}>
              {loading ? "Redeeming..." : "Confirm redemption"}
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
