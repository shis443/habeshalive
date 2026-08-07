"use client";

import type { BlocklistTerm } from "@habeshalive/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./AdminQueue.module.css";
import blocklistStyles from "./BlocklistManager.module.css";

type BlocklistLanguage = BlocklistTerm["language"];

// Module 5 — widened alongside db/migrations/0036 + schemas/admin.ts's
// blocklistTermSchema. Oromo and Somali ship with zero starter terms, same
// as Amharic originally did (see the empty-state copy below) — real terms
// come from a native speaker using this exact UI, not a guessed seed list.
const LANGUAGE_LABELS: Record<BlocklistLanguage, string> = {
  en: "English",
  am: "Amharic",
  om: "Oromo",
  so: "Somali",
  "am-latn": "Amharic (Latin)",
};
const LANGUAGES = Object.keys(LANGUAGE_LABELS) as BlocklistLanguage[];

export function BlocklistManager({ items }: { items: BlocklistTerm[] }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [language, setLanguage] = useState<BlocklistLanguage>("en");
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
          onChange={(e) => setLanguage(e.target.value as BlocklistLanguage)}
        >
          {LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {LANGUAGE_LABELS[lang]}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.approveButton} disabled={submitting || !term.trim()}>
          {submitting ? "Adding..." : "Add term"}
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}

      {LANGUAGES.map((lang) => {
        const langTerms = items.filter((i) => i.language === lang);
        return (
          <div key={lang}>
            <h3 className={blocklistStyles.groupHeading}>
              {LANGUAGE_LABELS[lang]} ({langTerms.length})
            </h3>
            {langTerms.length === 0 ? (
              <p className={styles.empty}>
                No {LANGUAGE_LABELS[lang]} terms yet — the blocklist ships empty until a native speaker reviews and
                adds real terms. Add them here.
              </p>
            ) : (
              <div className={blocklistStyles.chipRow}>
                {langTerms.map((t) => (
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
      })}
    </div>
  );
}
