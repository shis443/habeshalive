"use client";

import type { NotificationPreferences } from "@birq/shared";
import { useState } from "react";
import styles from "./AccountSection.module.css";

const ROWS: { key: keyof NotificationPreferences; label: string }[] = [
  { key: "liveAlerts", label: "Creators you follow going live" },
  { key: "gurshaReceived", label: "Gursha received" },
  { key: "subscriptionEvents", label: "Subscriptions (new, renewed, expiring)" },
  { key: "payoutEvents", label: "Payouts" },
  { key: "moderationEvents", label: "Moderation actions on your account" },
  { key: "giftCardEvents", label: "Gift cards" },
  { key: "marketing", label: "Product news and announcements" },
];

export function NotificationPreferencesSection({ initial }: { initial: NotificationPreferences }) {
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState<keyof NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: keyof NotificationPreferences) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(key);
    setError(null);
    try {
      const res = await fetch("/api/backend/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next[key] }),
      });
      if (!res.ok) throw new Error("Failed to save");
    } catch {
      setPrefs(prefs); // revert
      setError("Couldn't save that change — try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Notifications</h2>
      {ROWS.map((row) => (
        <div key={row.key} className={styles.field}>
          <div className={styles.row}>
            <span className={styles.fieldLabel} style={{ marginBottom: 0, flex: 1 }}>
              {row.label}
            </span>
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => toggle(row.key)}
              disabled={saving === row.key}
            >
              {prefs[row.key] ? "On" : "Off"}
            </button>
          </div>
        </div>
      ))}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
