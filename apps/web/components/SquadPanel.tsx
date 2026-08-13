"use client";

import type { Squad } from "@birq/shared";
import { useEffect, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./GoLivePanel.module.css";

// Module 3 — grid-view squad co-streaming controls, shown in GoLivePanel
// while the creator is live. Self-contained (fetches its own state) so
// it doesn't add to GoLivePanel's already-large state machine — see
// squad-service.ts for the backend side.
export function SquadPanel() {
  const [squad, setSquad] = useState<Squad | null | undefined>(undefined); // undefined = loading
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    fetch("/api/backend/streams/squad/mine")
      .then((res) => (res.ok ? unwrapClientData<Squad | null>(res) : null))
      .then(setSquad)
      .catch(() => setSquad(null));
  }

  useEffect(refresh, []);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/streams/squad", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create squad");
      }
      const data = await unwrapClientData<Squad>(res);
      setSquad(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/streams/squad/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: joinCode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to join squad");
      }
      const data = await unwrapClientData<Squad>(res);
      setSquad(data);
      setJoinCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/streams/squad/leave", { method: "POST" });
      if (!res.ok) throw new Error("Failed to leave squad");
      setSquad(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (squad === undefined) return null;

  return (
    <div className={styles.boostRow}>
      {squad ? (
        <>
          <p className={styles.fieldLabel}>
            Squad{squad.name ? `: ${squad.name}` : ""} — invite code <code>{squad.inviteCode}</code>
          </p>
          <p className={styles.subtext}>
            {squad.members.map((m) => `@${m.username}${m.stream ? " (live)" : " (offline)"}`).join(", ")}
          </p>
          <button type="button" className={styles.secondaryButton} onClick={handleLeave} disabled={busy}>
            {busy ? "Leaving…" : "Leave squad"}
          </button>
        </>
      ) : (
        <>
          <p className={styles.fieldLabel}>Squad co-streaming</p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={handleCreate} disabled={busy}>
              {busy ? "Creating…" : "Start a squad"}
            </button>
            <input
              type="text"
              className={styles.textInput}
              placeholder="Invite code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              maxLength={6}
            />
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleJoin}
              disabled={busy || joinCode.length === 0}
            >
              {busy ? "Joining…" : "Join"}
            </button>
          </div>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
