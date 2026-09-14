"use client";

import type { MyAccount, SocialLinkPlatform } from "@birq/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import styles from "./AccountSection.module.css";

const SOCIAL_PLATFORMS: { id: SocialLinkPlatform; label: string; placeholder: string }[] = [
  { id: "twitch", label: "Twitch", placeholder: "https://twitch.tv/yourname" },
  { id: "twitter", label: "X / Twitter", placeholder: "https://x.com/yourname" },
  { id: "youtube", label: "YouTube", placeholder: "https://youtube.com/@yourname" },
  { id: "instagram", label: "Instagram", placeholder: "https://instagram.com/yourname" },
  { id: "discord", label: "Discord", placeholder: "https://discord.gg/yourinvite" },
  { id: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@yourname" },
];

// A URL that fails to parse can't be rendered as a real link on the
// public profile — checked client-side so the error surfaces on the
// exact field, not as a generic 400 from the server's own zod .url().
function isValidOrEmptyUrl(value: string): boolean {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function ProfileSection({ account }: { account: MyAccount }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [bio, setBio] = useState(account.bio ?? "");
  const [socialLinks, setSocialLinks] = useState<Partial<Record<SocialLinkPlatform, string>>>(
    account.socialLinks
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const avatarUrl = resolveAvatarUrl(account.avatarUrl);
  const invalidPlatform = SOCIAL_PLATFORMS.find((p) => !isValidOrEmptyUrl(socialLinks[p.id] ?? ""));

  async function handleSave() {
    if (invalidPlatform) {
      setError(`${invalidPlatform.label} isn't a valid URL`);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      // Full replacement, not a per-key merge — send only the platforms
      // that currently have a non-empty value, matching updateProfile's
      // COALESCE-whole-column semantics server-side.
      const cleanedLinks = Object.fromEntries(
        Object.entries(socialLinks).filter(([, url]) => url && url.trim().length > 0)
      );
      const res = await fetch("/api/backend/auth/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, bio, socialLinks: cleanedLinks }),
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

      {SOCIAL_PLATFORMS.map((platform) => (
        <div className={styles.field} key={platform.id}>
          <label className={styles.fieldLabel} htmlFor={`social-${platform.id}`}>
            {platform.label}
          </label>
          <input
            id={`social-${platform.id}`}
            type="url"
            className={styles.input}
            placeholder={platform.placeholder}
            value={socialLinks[platform.id] ?? ""}
            onChange={(e) => setSocialLinks((prev) => ({ ...prev, [platform.id]: e.target.value }))}
            maxLength={300}
          />
        </div>
      ))}

      <button type="button" className={styles.button} onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>Saved.</p>}
    </div>
  );
}
