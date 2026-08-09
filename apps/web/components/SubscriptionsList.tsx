"use client";

import { formatSantimAsBirr, type MySubscription } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./SubscriptionsList.module.css";

const STATUS_LABEL: Record<MySubscription["status"], string> = {
  active: "Active",
  payment_failed: "Payment failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

function statusClass(status: MySubscription["status"]): string {
  switch (status) {
    case "active":
      return styles.statusActive ?? "";
    case "payment_failed":
      return styles.statusWarning ?? "";
    case "cancelled":
    case "expired":
      return styles.statusEnded ?? "";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function SubscriptionsList({ subscriptions }: { subscriptions: MySubscription[] }) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel(id: string) {
    setError(null);
    setCancellingId(id);
    try {
      const res = await fetch(`/api/backend/subscriptions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to cancel subscription");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Manage subscriptions</h2>
      {subscriptions.length === 0 ? (
        <p className={styles.empty}>You&apos;re not subscribed to anyone yet.</p>
      ) : (
        <div>
          {subscriptions.map((sub) => (
            <div key={sub.id} className={styles.row}>
              <div>
                <p className={styles.title}>{sub.creatorDisplayName}</p>
                <p className={styles.meta}>
                  {sub.tierName} · {formatSantimAsBirr(sub.priceSantim)}/mo
                </p>
                <p className={styles.meta}>
                  {sub.status === "active" ? "Renews" : "Access until"} {formatDate(sub.expiresAt)}
                </p>
              </div>
              <div className={styles.actionWrap}>
                <span className={`${styles.statusPill} ${statusClass(sub.status)}`}>
                  {STATUS_LABEL[sub.status]}
                </span>
                {(sub.status === "active" || sub.status === "payment_failed") && (
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => handleCancel(sub.id)}
                    disabled={cancellingId === sub.id}
                  >
                    {cancellingId === sub.id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
