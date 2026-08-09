"use client";

import { formatSantimAsBirr, type CreatorAdsSettings } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdsManagerPanel.module.css";

export function AdsManagerPanel({ settings }: { settings: CreatorAdsSettings | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/ads/creator-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adsEnabled: !settings.adsEnabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>Ads Manager</h2>
        <button type="button" className={settings.adsEnabled ? styles.toggleOn : styles.toggleOff} disabled={saving} onClick={toggle}>
          {settings.adsEnabled ? "Ads on" : "Ads off"}
        </button>
      </div>
      <p className={styles.subtext}>
        {settings.adsEnabled
          ? "Display banners and sponsored placements can show on your stream. Active subscribers never see them."
          : "Ads are off — nothing will show on your stream until you turn this on."}
      </p>
      <div className={styles.revenueRow}>
        <span className={styles.revenueLabel}>Ad revenue this month</span>
        <span className={styles.revenueValue}>{formatSantimAsBirr(settings.revenueThisMonthSantim)}</span>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
