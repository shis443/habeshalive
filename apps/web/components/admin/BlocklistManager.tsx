"use client";

import type { BlocklistTerm } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import blocklistStyles from "./BlocklistManager.module.css";

export function BlocklistManager({ items }: { items: BlocklistTerm[] }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [language, setLanguage] = useState<"en" | "am">("en");
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/backend/moderation/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: term.trim(), language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add term");
      setTerm("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeTerm(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/backend/moderation/blocklist/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to remove term");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRemovingId(null);
    }
  }

  const enTerms = items.filter((i) => i.language === "en");
  const amTerms = items.filter((i) => i.language === "am");

  return (
    <div>
      <form className={blocklistStyles.form} onSubmit={addTerm}>
        <input
          type="text"
          className={blocklistStyles.input}
          placeholder="New term or phrase"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <select
          className={blocklistStyles.select}
          value={language}
          onChange={(e) => setLanguage(e.target.value as "en" | "am")}
        >
          <option value="en">English</option>
          <option value="am">Amharic</option>
        </select>
        <button type="submit" className={styles.approveButton} disabled={submitting || !term.trim()}>
          {submitting ? "Adding..." : "Add term"}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}

      <h3 className={blocklistStyles.groupHeading}>English ({enTerms.length})</h3>
      {enTerms.length === 0 ? (
        <p className={styles.empty}>No English terms.</p>
      ) : (
        <div className={blocklistStyles.chipRow}>
          {enTerms.map((t) => (
            <span key={t.id} className={blocklistStyles.chip}>
              {t.term}
              <button type="button" onClick={() => removeTerm(t.id)} disabled={removingId === t.id}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <h3 className={blocklistStyles.groupHeading}>Amharic ({amTerms.length})</h3>
      {amTerms.length === 0 ? (
        <p className={styles.empty}>
          No Amharic terms yet — the blocklist ships empty for Amharic until a native speaker reviews and adds real
          terms. Add them here.
        </p>
      ) : (
        <div className={blocklistStyles.chipRow}>
          {amTerms.map((t) => (
            <span key={t.id} className={blocklistStyles.chip}>
              {t.term}
              <button type="button" onClick={() => removeTerm(t.id)} disabled={removingId === t.id}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
