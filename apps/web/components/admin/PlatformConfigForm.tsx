"use client";

import { santimToBirr, birrToSantim, type PlatformConfig } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import filterStyles from "./PayoutHistoryFilters.module.css";
import formStyles from "./ManualAdjustmentForm.module.css";

export function PlatformConfigForm({ config }: { config: PlatformConfig | null }) {
  const router = useRouter();
  const [priceBirr, setPriceBirr] = useState(config ? String(santimToBirr(config.boostPriceSantim)) : "");
  const [durationHours, setDurationHours] = useState(config ? String(config.boostDurationMs / 3_600_000) : "");
  const [revenueSharePct, setRevenueSharePct] = useState(config ? String(config.defaultRevenueShareBps / 100) : "");
  const [reviewThresholdBirr, setReviewThresholdBirr] = useState(
    config ? String(santimToBirr(config.payoutManualReviewThresholdSantim)) : ""
  );
  const [vodDefaultDays, setVodDefaultDays] = useState(config ? String(config.vodRetentionDaysDefault) : "");
  const [vodAnchorDays, setVodAnchorDays] = useState(config ? String(config.vodRetentionDaysAnchor) : "");
  const [approvedCreatorCap, setApprovedCreatorCap] = useState(config ? String(config.approvedCreatorCap) : "");
  const [adRevenueSharePct, setAdRevenueSharePct] = useState(config ? String(config.adRevenueShareBps / 100) : "");
  const [adFrequencyCap, setAdFrequencyCap] = useState(config ? String(config.adFrequencyCapPerHour) : "");
  const [giftCardExpiryMonths, setGiftCardExpiryMonths] = useState(config ? String(config.giftCardExpiryMonths) : "");
  const [kycRequiredForPayouts, setKycRequiredForPayouts] = useState(config?.kycRequiredForPayouts ?? false);
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
          defaultRevenueShareBps: Math.round(parseFloat(revenueSharePct || "0") * 100),
          payoutManualReviewThresholdSantim: birrToSantim(parseFloat(reviewThresholdBirr || "0")),
          vodRetentionDaysDefault: Math.round(parseFloat(vodDefaultDays || "0")),
          vodRetentionDaysAnchor: Math.round(parseFloat(vodAnchorDays || "0")),
          approvedCreatorCap: Math.round(parseFloat(approvedCreatorCap || "0")),
          adRevenueShareBps: Math.round(parseFloat(adRevenueSharePct || "0") * 100),
          adFrequencyCapPerHour: Math.round(parseFloat(adFrequencyCap || "0")),
          giftCardExpiryMonths: Math.round(parseFloat(giftCardExpiryMonths || "0")),
          kycRequiredForPayouts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update settings");
      setMessage({ text: "Settings updated — takes effect immediately, no deploy needed.", isError: false });
      router.refresh();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Something went wrong", isError: true });
    } finally {
      setSubmitting(false);
    }
  }

  if (!config) return <p className={styles.error}>Couldn&apos;t load platform config.</p>;

  return (
    <div className={formStyles.form}>
      <p className={formStyles.warning}>
        Every field here is read live by the code that uses it — changes take effect on the next relevant action, no
        deploy needed. Last changed by {config.updatedByUsername ? `@${config.updatedByUsername}` : "the system default"}.
      </p>

      <label className={formStyles.fieldLabel}>Boost pricing</label>
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

      <label className={formStyles.fieldLabel}>Default revenue share for new creators (%)</label>
      <input
        type="number"
        step="0.5"
        min="0"
        max="100"
        className={filterStyles.input}
        value={revenueSharePct}
        onChange={(e) => setRevenueSharePct(e.target.value)}
      />

      <label className={formStyles.fieldLabel}>Payout manual-review threshold (ETB)</label>
      <input
        type="number"
        step="1"
        className={filterStyles.input}
        value={reviewThresholdBirr}
        onChange={(e) => setReviewThresholdBirr(e.target.value)}
      />

      <label className={formStyles.fieldLabel}>VOD retention (days)</label>
      <div className={formStyles.row}>
        <input
          type="number"
          step="1"
          className={filterStyles.input}
          placeholder="Default"
          value={vodDefaultDays}
          onChange={(e) => setVodDefaultDays(e.target.value)}
        />
        <input
          type="number"
          step="1"
          className={filterStyles.input}
          placeholder="Anchor creators"
          value={vodAnchorDays}
          onChange={(e) => setVodAnchorDays(e.target.value)}
        />
      </div>

      <label className={formStyles.fieldLabel}>Approved creator cap (A.4 launch gate)</label>
      <input
        type="number"
        step="1"
        className={filterStyles.input}
        value={approvedCreatorCap}
        onChange={(e) => setApprovedCreatorCap(e.target.value)}
      />

      <label className={formStyles.fieldLabel}>Ad revenue share to creators (%)</label>
      <input
        type="number"
        step="0.5"
        min="0"
        max="100"
        className={filterStyles.input}
        value={adRevenueSharePct}
        onChange={(e) => setAdRevenueSharePct(e.target.value)}
      />

      <label className={formStyles.fieldLabel}>Ad frequency cap (max times a viewer sees one creative per hour)</label>
      <input
        type="number"
        step="1"
        className={filterStyles.input}
        value={adFrequencyCap}
        onChange={(e) => setAdFrequencyCap(e.target.value)}
      />

      <label className={formStyles.fieldLabel}>Gift card expiry (months)</label>
      <input
        type="number"
        step="1"
        className={filterStyles.input}
        value={giftCardExpiryMonths}
        onChange={(e) => setGiftCardExpiryMonths(e.target.value)}
      />

      <label className={formStyles.fieldLabel}>
        <input
          type="checkbox"
          checked={kycRequiredForPayouts}
          onChange={(e) => setKycRequiredForPayouts(e.target.checked)}
          style={{ marginRight: 8 }}
        />
        Require approved identity verification (KYC) before payouts
      </label>
      <p className={formStyles.warning}>
        When on, a creator&apos;s payout requests are blocked until an admin approves a Fayda/Kebele ID
        submission under KYC review. Off by default so this doesn&apos;t block existing creators&apos;
        payouts before the review queue is actually staffed.
      </p>

      <button type="button" className={styles.approveButton} disabled={submitting} onClick={submit}>
        {submitting ? "Saving..." : "Save settings"}
      </button>
      {message && <p className={message.isError ? styles.error : formStyles.success}>{message.text}</p>}
    </div>
  );
}
