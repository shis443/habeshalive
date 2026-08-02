"use client";

import { useState } from "react";
import styles from "./AccountSection.module.css";

export function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/backend/auth/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: hasPassword ? currentPassword : undefined, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to change password");
      setCurrentPassword("");
      setNewPassword("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Password</h2>
      {hasPassword ? (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            className={styles.input}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
      ) : (
        <p className={styles.hint}>
          Your account doesn&apos;t have a password yet — it was created with a code sent to your
          phone or email. Set one below to be able to log in without a code.
        </p>
      )}
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="new-password">
          {hasPassword ? "New password" : "Password"}
        </label>
        <input
          id="new-password"
          type="password"
          className={styles.input}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          minLength={8}
        />
      </div>
      <button
        type="button"
        className={styles.button}
        onClick={handleSave}
        disabled={saving || newPassword.length < 8 || (hasPassword && !currentPassword)}
      >
        {saving ? "Saving…" : hasPassword ? "Change password" : "Set password"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>Password updated.</p>}
    </div>
  );
}
