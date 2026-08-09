"use client";

import type { MyAccount } from "@birq/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import styles from "./AccountSection.module.css";

export function ProfileSection({ account }: { account: MyAccount }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [bio, setBio] = useState(account.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const avatarUrl = resolveAvatarUrl(account.avatarUrl);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/backend/auth/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, bio }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
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
      <h2 className={styles.title}>Profile</h2>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Avatar</span>
        <div className={styles.row}>
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" width={56} height={56} style={{ borderRadius: "50%" }} />
          ) : (
            <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--surface-container-high)", display: "block" }} />
          )}
          {/* E.7: the picker itself lives at /avatar (already built —
              layered SVG parts, /avatars/compose, randomize). This links
              to it rather than re-embedding the whole editor here. */}
          <Link href="/avatar" className={styles.buttonSecondary}>
            Change avatar
          </Link>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="display-name">
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          className={styles.input}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={50}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="bio">
          Bio
        </label>
        <textarea
          id="bio"
          className={styles.textarea}
          rows={3}
          maxLength={300}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
      </div>

      <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>Saved.</p>}
    </div>
  );
}
