"use client";

import type { ChannelBlock, ChannelModerator } from "@birq/shared";
import { useEffect, useState } from "react";
import styles from "./ModerationPanel.module.css";

// Module 5 — real per-channel moderator RBAC + channel blocks, replacing
// the old static placeholder (auto-mod/blocked-words/timeout-queue UI that
// had no backing tables). See moderation/channel-mods-service.ts.
export function ModerationPanel({ creatorId }: { creatorId: string }) {
  const [moderators, setModerators] = useState<ChannelModerator[] | null>(null);
  const [blocks, setBlocks] = useState<ChannelBlock[] | null>(null);
  const [modUsername, setModUsername] = useState("");
  const [blockUsername, setBlockUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    fetch(`/api/backend/moderation/channel/${creatorId}/moderators`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setModerators)
      .catch(() => setModerators([]));
    fetch(`/api/backend/moderation/channel/${creatorId}/blocks`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setBlocks)
      .catch(() => setBlocks([]));
  }

  useEffect(refresh, [creatorId]);

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

  async function addModerator() {
    await withBusy(async () => {
      const res = await fetch(`/api/backend/moderation/channel/${creatorId}/moderators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: modUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add moderator");
      setModUsername("");
      refresh();
    });
  }

  async function removeModerator(userId: string) {
    await withBusy(async () => {
      const res = await fetch(`/api/backend/moderation/channel/${creatorId}/moderators/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove moderator");
      refresh();
    });
  }

  async function addBlock() {
    await withBusy(async () => {
      const res = await fetch(`/api/backend/moderation/channel/${creatorId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: blockUsername }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to block viewer");
      setBlockUsername("");
      refresh();
    });
  }

  async function removeBlock(userId: string) {
    await withBusy(async () => {
      const res = await fetch(`/api/backend/moderation/channel/${creatorId}/blocks/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to unblock viewer");
      refresh();
    });
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.heading}>Moderation</h2>

      <p className={styles.sectionLabel}>Channel moderators</p>
      {(moderators ?? []).map((m) => (
        <div key={m.userId} className={styles.row}>
          <span className={styles.rowLabel}>@{m.username}</span>
          <button type="button" className={styles.removeButton} onClick={() => removeModerator(m.userId)} disabled={busy}>
            Remove
          </button>
        </div>
      ))}
      {moderators?.length === 0 && <p className={styles.emptyText}>No channel moderators yet.</p>}
      <div className={styles.addRow}>
        <input
          type="text"
          className={styles.input}
          placeholder="Username"
          value={modUsername}
          onChange={(e) => setModUsername(e.target.value)}
        />
        <button type="button" className={styles.addButton} onClick={addModerator} disabled={busy || !modUsername}>
          Add
        </button>
      </div>

      <p className={styles.sectionLabel}>Blocked from your channel</p>
      {(blocks ?? []).map((b) => (
        <div key={b.userId} className={styles.row}>
          <span className={styles.rowLabel}>@{b.username}</span>
          <button type="button" className={styles.removeButton} onClick={() => removeBlock(b.userId)} disabled={busy}>
            Unblock
          </button>
        </div>
      ))}
      {blocks?.length === 0 && <p className={styles.emptyText}>No one is blocked.</p>}
      <div className={styles.addRow}>
        <input
          type="text"
          className={styles.input}
          placeholder="Username"
          value={blockUsername}
          onChange={(e) => setBlockUsername(e.target.value)}
        />
        <button type="button" className={styles.addButton} onClick={addBlock} disabled={busy || !blockUsername}>
          Block
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
