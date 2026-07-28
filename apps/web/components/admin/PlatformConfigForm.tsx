"use client";

import { santimToBirr, birrToSantim, type PlatformConfig } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import filterStyles from "./PayoutHistoryFilters.module.css";
import formStyles from "./ManualAdjustmentForm.module.css";

export function PlatformConfigForm({ config }: { config: PlatformConfig | null }) {
  const router = useRouter();
  const [priceBirr, setPriceBirr] = useState(config ? String(santimToBirr(config.boostPriceSantim)) : "");
  const [durationHours, setDurationHours] = useState(config ? String(config.boostDurationMs / 3_600_000) : "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backend/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boostPriceSantim: birrToSantim(parseFloat(priceBirr || "0")),
          boostDurationMs: Math.round(parseFloat(durationHours || "0") * 3_600_000),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update pricing");
      setMessage({ text: "Boost pricing updated — takes effect on the next purchase immediately.", isError: false });
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Something went wrong", isError: true });
    } finally {
      setSubmitting(false);
    }
  }

  if (!config) return <p className={styles.error}>Couldn&apos;t load pricing config.</p>;

  return (
    <div className={formStyles.form}>
      <p className={formStyles.warning}>
        Changes here take effect on the very next boost purchase — no deploy needed. Last changed by{" "}
        {config.updatedByUsername ? `@${config.updatedByUsername}` : "the system default"}.
      </p>
      <div className={formStyles.row}>
        <input
          type="number"
          step="0.01"
          className={filterStyles.input}
          placeholder="Price (ETB / hour)"
          value={priceBirr}
          onChange={(e) => setPriceBirr(e.target.value)}
        />
        <input
          type="number"
          step="0.5"
          className={filterStyles.input}
          placeholder="Duration (hours)"
          value={durationHours}
          onChange={(e) => setDurationHours(e.target.value)}
        />
      </div>
      <button type="button" className={styles.approveButton} disabled={submitting} onClick={submit}>
        {submitting ? "Saving..." : "Save pricing"}
      </button>
      {message && <p className={message.isError ? styles.error : formStyles.success}>{message.text}</p>}
    </div>
  );
}
