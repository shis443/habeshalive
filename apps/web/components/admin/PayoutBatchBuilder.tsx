"use client";

import { formatSantimAsBirr, type EligibleCreatorForBatch, type PayoutMethod } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import queueStyles from "./AdminQueue.module.css";
import styles from "./PayoutBatchBuilder.module.css";

const METHODS: { value: PayoutMethod; label: string }[] = [
  { value: "telebirr", label: "Telebirr" },
  { value: "bank", label: "Bank" },
];

// Never hides an ineligible creator — every row is always rendered, with
// its specific blocking reasons shown, per T7's own acceptance criterion.
export function PayoutBatchBuilder() {
  const router = useRouter();
  const [method, setMethod] = useState<PayoutMethod>("telebirr");
  const [creators, setCreators] = useState<EligibleCreatorForBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected({});
    setError(null);
    fetch(`/api/backend/admin/payout-batches/eligible-creators?method=${method}`)
      .then((res) => unwrapClientData<EligibleCreatorForBatch[]>(res))
      .then((data) => {
        if (!cancelled) setCreators(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load eligible creators");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [method]);

  function toggle(creator: EligibleCreatorForBatch) {
    setSelected((prev) => {
      const next = { ...prev };
      if (creator.creatorId in next) {
        delete next[creator.creatorId];
      } else {
        next[creator.creatorId] = creator.withdrawableSantim;
      }
      return next;
    });
  }

  function setAmount(creatorId: string, withdrawableSantim: number, raw: string) {
    const parsed = Math.max(0, Math.min(withdrawableSantim, Math.round(Number(raw) * 100) || 0));
    setSelected((prev) => ({ ...prev, [creatorId]: parsed }));
  }

  const selectedIds = Object.keys(selected);
  const totalSantim = Object.values(selected).reduce((sum, v) => sum + v, 0);

  async function submit() {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/admin/payout-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          selections: selectedIds
            .filter((id) => selected[id]! > 0)
            .map((id) => ({ creatorId: id, amountSantim: selected[id]! })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create batch");
      setSelected({});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={styles.methodTabs}>
        {METHODS.map((m) => (
          <button
            key={m.value}
            type="button"
            className={m.value === method ? styles.methodTabActive : styles.methodTab}
            onClick={() => setMethod(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading && <p className={queueStyles.empty}>Loading eligible creators…</p>}
      {!loading && creators.length === 0 && (
        <p className={queueStyles.empty}>No creator has set up a {method} payout method yet.</p>
      )}

      {!loading &&
        creators.map((creator) => {
          const isSelected = creator.creatorId in selected;
          return (
            <div key={creator.creatorId} className={creator.eligible ? styles.creatorRow : styles.creatorRowDisabled}>
              <input
                type="checkbox"
                checked={isSelected}
                disabled={!creator.eligible}
                onChange={() => toggle(creator)}
              />
              <div className={styles.creatorInfo}>
                <span className={styles.creatorName}>@{creator.username}</span>
                <span className={styles.creatorMeta}>
                  Withdrawable: {formatSantimAsBirr(creator.withdrawableSantim)}
                </span>
                {creator.blockingReasons.length > 0 && (
                  <div className={styles.blockingReasons}>
                    {creator.blockingReasons.map((reason) => (
                      <span key={reason} className={styles.blockingReason}>
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <input
                type="number"
                className={styles.amountInput}
                disabled={!isSelected}
                value={isSelected ? (selected[creator.creatorId]! / 100).toFixed(2) : ""}
                min={0}
                max={creator.withdrawableSantim / 100}
                step={0.01}
                onChange={(e) => setAmount(creator.creatorId, creator.withdrawableSantim, e.target.value)}
              />
            </div>
          );
        })}

      {!loading && creators.length > 0 && (
        <div className={styles.summaryBar}>
          <span className={styles.summaryTotal}>
            {selectedIds.length} creator{selectedIds.length === 1 ? "" : "s"} · {formatSantimAsBirr(totalSantim)}
          </span>
          <button
            type="button"
            className={styles.submitButton}
            disabled={submitting || selectedIds.length === 0 || totalSantim === 0}
            onClick={submit}
          >
            {submitting ? "Creating…" : "Submit for approval"}
          </button>
        </div>
      )}

      {error && <p className={queueStyles.error}>{error}</p>}
    </div>
  );
}
