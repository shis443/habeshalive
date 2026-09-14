"use client";

import type { Emote } from "@birq/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { resolveAvatarUrl } from "@/lib/avatar";
import styles from "./AccountSection.module.css";

const STATUS_LABEL: Record<Emote["status"], string> = {
  pending: "Awaiting review",
  approved: "Live — usable by everyone",
  rejected: "Not approved",
};

// Build 3 — Birq Plus's "global emote slot" perk. isBirqPlus gates the
// upload form (the API itself enforces this too — see
// emotes/service.ts's createEmote — this is just the friendlier
// client-side message instead of a raw 403 after submitting).
export function EmoteSection({ isBirqPlus, initial }: { isBirqPlus: boolean; initial: Emote[] }) {
  const router = useRouter();
  const [emotes, setEmotes] = useState(initial);
  const [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("code", code.trim());
      formData.append("image", file);
      const res = await fetch("/api/backend/emotes", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to upload");
      setEmotes((prev) => [data.data as Emote, ...prev]);
      setCode("");
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this emote? This can't be undone.")) return;
    try {
      const res = await fetch(`/api/backend/emotes/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Failed to delete");
      setEmotes((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setError("Failed to delete that emote");
    }
  }

  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Custom emotes</h2>
      <p className={styles.hint}>
        Birq Plus&apos;s global emote slot — upload a custom emote, and once approved it&apos;s usable by every
        chatter on the platform, typed as <code>:code:</code>.
      </p>

      {!isBirqPlus && (
        <p className={styles.hint}>
          Uploading custom emotes is a{" "}
          <Link href="/birq-plus" className={styles.link}>
            Birq Plus
          </Link>{" "}
          perk.
        </p>
      )}

      {emotes.length > 0 && (
        <ul className={styles.list}>
          {emotes.map((emote) => (
            <li key={emote.id} className={styles.listRow}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveAvatarUrl(emote.imageUrl) ?? undefined}
                alt={emote.code}
                width={28}
                height={28}
                style={{ objectFit: "contain" }}
              />
              <span>:{emote.code}:</span>
              <span className={styles.hint}>{STATUS_LABEL[emote.status]}</span>
              {emote.rejectionReason && <span className={styles.error}>{emote.rejectionReason}</span>}
              <button type="button" className={styles.linkButton} onClick={() => remove(emote.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {isBirqPlus && (
        <form onSubmit={submit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="emote-code">
              Code (letters, digits, underscores)
            </label>
            <input
              id="emote-code"
              type="text"
              className={styles.input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={32}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="emote-file">
              Image (PNG, JPEG, or GIF — max 512KB)
            </label>
            <input
              id="emote-file"
              type="file"
              accept="image/png,image/jpeg,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.button} disabled={busy || !file || !code.trim()}>
            {busy ? "Uploading…" : "Submit for review"}
          </button>
        </form>
      )}
    </div>
  );
}
