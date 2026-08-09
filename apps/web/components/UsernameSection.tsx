"use client";

import type { MyAccount } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AccountSection.module.css";

// E.1: [CONFIRM] default — once per 30 days, enforced server-side
// (auth/service.ts's changeUsername). This form doesn't try to predict
// the cooldown client-side; it just surfaces whatever the server says.
export function UsernameSection({ account }: { account: MyAccount }) {
  const router = useRouter();
  const [username, setUsername] = useState(account.username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    if (username === account.username) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/backend/auth/account/username", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to change username");
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Username</h2>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="username">
          Username
        </label>
        <div className={styles.row}>
          <input
            id="username"
            type="text"
            className={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            maxLength={30}
          />
          <button
            type="button"
            className={styles.button}
            onClick={handleSave}
            disabled={saving || username === account.username}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <p className={styles.hint}>Can be changed once every 30 days.</p>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>Username updated.</p>}
    </div>
  );
}
