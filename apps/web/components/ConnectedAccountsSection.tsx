"use client";

import type { LinkedSocialAccount, SocialProvider } from "@birq/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AccountSection.module.css";

const PROVIDER_LABEL: Record<SocialProvider, string> = { google: "Google", apple: "Apple" };

// E.3: unlinking is blocked server-side (auth/social-service.ts) if it
// would leave zero working sign-in methods — this UI doesn't try to
// duplicate that logic, it just surfaces whatever error the server
// returns rather than pre-guessing which buttons should be disabled.
export function ConnectedAccountsSection({
  accounts,
  hasPassword,
  hasPhoneOrEmail,
}: {
  accounts: LinkedSocialAccount[];
  hasPassword: boolean;
  hasPhoneOrEmail: boolean;
}) {
  const router = useRouter();
  const [unlinking, setUnlinking] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlink(provider: SocialProvider) {
    setUnlinking(provider);
    setError(null);
    try {
      const res = await fetch(`/api/backend/auth/social/${provider}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to unlink");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUnlinking(null);
    }
  }

  const linkedProviders = new Set(accounts.map((a) => a.provider));
  const canUnlinkAnything = hasPassword || hasPhoneOrEmail || accounts.length > 1;

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Connected accounts</h2>
      {(["google", "apple"] as const).map((provider) => {
        const linked = accounts.find((a) => a.provider === provider);
        return (
          <div key={provider} className={styles.field}>
            <div className={styles.row}>
              <span className={styles.currentValue} style={{ flex: 1, margin: 0 }}>
                {PROVIDER_LABEL[provider]}
                {linked && <span className={styles.hint}> — {linked.email ?? "linked"}</span>}
              </span>
              {linked ? (
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => handleUnlink(provider)}
                  disabled={unlinking === provider || !canUnlinkAnything}
                  title={canUnlinkAnything ? undefined : "Add a password, phone, or email first"}
                >
                  {unlinking === provider ? "Unlinking…" : "Unlink"}
                </button>
              ) : (
                <span className={styles.hint}>Not linked</span>
              )}
            </div>
          </div>
        );
      })}
      {linkedProviders.size === 0 && (
        <p className={styles.hint}>Linking happens from the sign-in screen — log in with Google or Apple once to link it here.</p>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
