"use client";

import type { SessionAccount } from "@birq/shared";
import { useEffect, useState } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import styles from "./AccountSection.module.css";

// E.2: multi-session account switching, adapted to this app's httpOnly
// cookie (see lib/session.ts's comment on why — the spec's assumed
// localStorage token model doesn't exist here). Talks to /api/session/*
// (Next.js route handlers), never the Fastify API directly — those routes
// are what actually read/write the cookie server-side.
export function SessionsSection() {
  const [accounts, setAccounts] = useState<SessionAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch("/api/session/accounts")
      .then((res) => (res.ok ? res.json() : []))
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }

  useEffect(load, []);

  async function switchTo(userId: string) {
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch("/api/session/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error("Failed to switch accounts");
      // Hard navigation, not router.refresh() — every server-rendered
      // piece of the app (wallet balance, notifications, subscriptions)
      // needs to re-fetch under the new active account, and a hard
      // reload is the simplest way to guarantee nothing from the
      // previous account's client-side state survives the switch (this
      // is the specific bug class the spec calls out as most likely
      // here).
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
    }
  }

  async function removeAccount(userId: string) {
    setBusy(userId);
    setError(null);
    try {
      const res = await fetch("/api/session/accounts/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error("Failed to remove account");
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
    }
  }

  async function logOutCurrent() {
    setBusy("__current__");
    await fetch("/api/session", { method: "DELETE" });
    window.location.href = "/";
  }

  async function logOutAll() {
    setBusy("__all__");
    await fetch("/api/session?all=true", { method: "DELETE" });
    window.location.href = "/";
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Active sessions</h2>
      {accounts === null ? (
        <p className={styles.hint}>Loading…</p>
      ) : (
        <>
          {accounts.map((account) => {
            const avatarUrl = resolveAvatarUrl(account.avatarUrl);
            return (
              <div key={account.userId} className={styles.field}>
                <div className={styles.row}>
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" width={32} height={32} style={{ borderRadius: "50%" }} />
                  ) : (
                    <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--surface-container-high)", display: "block" }} />
                  )}
                  <span style={{ flex: 1 }}>
                    <span className={styles.currentValue} style={{ margin: 0 }}>
                      {account.displayName} {account.isActive && "(active)"}
                    </span>
                    {account.isStale && <p className={styles.error} style={{ margin: 0 }}>Needs re-authentication</p>}
                  </span>
                  {!account.isActive && (
                    <button
                      type="button"
                      className={styles.buttonSecondary}
                      onClick={() => switchTo(account.userId)}
                      disabled={busy === account.userId}
                    >
                      Switch
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    onClick={() => removeAccount(account.userId)}
                    disabled={busy === account.userId}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          {accounts.length < 5 && (
            <a href="/login?addAccount=true" className={styles.buttonSecondary} style={{ display: "inline-block", marginBottom: "var(--space-3)" }}>
              Add another account
            </a>
          )}

          <div className={styles.row}>
            <button type="button" className={styles.buttonSecondary} onClick={logOutCurrent} disabled={busy === "__current__"}>
              Log out of this account
            </button>
            {accounts.length > 1 && (
              <button type="button" className={styles.buttonDanger} onClick={logOutAll} disabled={busy === "__all__"}>
                Log out of all accounts
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
