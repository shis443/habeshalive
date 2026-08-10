"use client";

import type { RemoteControlAssistant } from "@birq/shared";
import { useEffect, useState } from "react";
import styles from "./ModerationPanel.module.css";

// Phase 2.2 — grant/revoke for remote_control_assistants
// (apps/api/src/remote-control/assistants-service.ts). Mirrors
// ModerationPanel.tsx's channel-moderator grant/revoke UI closely (same
// fetch/refresh/withBusy shape, same styles.module.css) since it's the
// same underlying pattern: creator grants a named privilege to another
// user by username, sees the current list, can revoke. A granted
// assistant gets a real, narrower command set at the relay (setLive/
// setRecord stay owner-only) — see RemoteControlPanel's own comment for
// how a grant here actually becomes usable access.
export function RemoteControlAssistantsPanel({ streamerId }: { streamerId: string }) {
  const [assistants, setAssistants] = useState<RemoteControlAssistant[] | null>(null);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    fetch(`/api/backend/remote-control/${streamerId}/assistants`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => setAssistants(body.data ?? []))
      .catch(() => setAssistants([]));
  }

  useEffect(refresh, [streamerId]);

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function addAssistant() {
    await withBusy(async () => {
      const res = await fetch(`/api/backend/remote-control/${streamerId}/assistants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add assistant");
      setUsername("");
      refresh();
    });
  }

  async function removeAssistant(userId: string) {
    await withBusy(async () => {
      const res = await fetch(`/api/backend/remote-control/${streamerId}/assistants/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove assistant");
      refresh();
    });
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Remote Control Assistants</h2>
      <p className={styles.emptyText}>
        Assistants can switch scenes, mute, and adjust bitrate/zoom remotely. They can&apos;t end your stream or start/stop
        recording — those stay owner-only.
      </p>

      {(assistants ?? []).map((a) => (
        <div key={a.userId} className={styles.row}>
          <span className={styles.rowLabel}>@{a.username}</span>
          <button type="button" className={styles.removeButton} onClick={() => removeAssistant(a.userId)} disabled={busy}>
            Remove
          </button>
        </div>
      ))}
      {assistants?.length === 0 && <p className={styles.emptyText}>No remote control assistants yet.</p>}
      <div className={styles.addRow}>
        <input
          type="text"
          className={styles.input}
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="button" className={styles.addButton} onClick={addAssistant} disabled={busy || !username}>
          Add
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
