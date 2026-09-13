"use client";

import type { TaxProfile } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";

const RESIDENCY_LABEL: Record<TaxProfile["residency"], string> = {
  et_resident: "Resident of Ethiopia",
  diaspora: "Ethiopian diaspora",
  other: "Other / foreign resident",
};

export function TaxProfileQueue({ items }: { items: TaxProfile[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(id: string) {
    const raw = window.prompt("Withholding rate in basis points (0-10000, e.g. 1500 = 15%):", "0");
    if (raw === null) return;
    const withholdingBps = Number(raw);
    if (!Number.isInteger(withholdingBps) || withholdingBps < 0 || withholdingBps > 10_000) {
      window.alert("Enter a whole number between 0 and 10000");
      return;
    }
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/tax-profiles/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withholdingBps }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to verify tax profile");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting (shown to the creator):");
    if (!reason) return;
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/admin/tax-profiles/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to reject tax profile");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) return <p className={styles.empty}>No tax profiles awaiting review.</p>;

  return (
    <div>
      <div className={styles.list}>
        {items.map((item) => (
          <div key={item.id} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>{RESIDENCY_LABEL[item.residency]}</span>
              <span className={styles.rowMeta}>
                {item.formType && item.formType !== "none" ? item.formType.toUpperCase() : "No withholding form"}
                {item.tin ? ` · TIN ${item.tin}` : ""}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.denyButton}
                disabled={pendingId === item.id}
                onClick={() => reject(item.id)}
              >
                Reject
              </button>
              <button
                type="button"
                className={styles.approveButton}
                disabled={pendingId === item.id}
                onClick={() => approve(item.id)}
              >
                Verify
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
