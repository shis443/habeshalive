"use client";

import { STREAM_LANGUAGES } from "@birq/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import styles from "./BrowseFilterBar.module.css";

const SORTS = [
  { value: "viewers", label: "Most viewers" },
  { value: "recent", label: "Recently started" },
  { value: "alphabetical", label: "A–Z" },
] as const;

// Reads/writes the same query params the server component
// (app/browse/page.tsx) parses — a shareable, bookmarkable URL, same
// reasoning as CategoryPills on the homepage. Only this bar and its
// inputs are client-side; the actual filtered fetch stays server-side.
export function BrowseFilterBar({
  language,
  tag,
  sort,
}: {
  language: string;
  tag: string;
  sort: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tagInput, setTagInput] = useState(tag);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/browse?${params.toString()}`);
  }

  return (
    <div className={styles.bar}>
      <select
        className={styles.select}
        value={language}
        onChange={(e) => updateParam("language", e.target.value)}
      >
        <option value="">All languages</option>
        {STREAM_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {lang}
          </option>
        ))}
      </select>

      <select className={styles.select} value={sort} onChange={(e) => updateParam("sort", e.target.value)}>
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <form
        className={styles.tagForm}
        onSubmit={(e) => {
          e.preventDefault();
          updateParam("tag", tagInput.trim().toLowerCase());
        }}
      >
        <input
          type="text"
          className={styles.tagInput}
          placeholder="Search by tag..."
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
        />
        {tag && (
          <button
            type="button"
            className={styles.clearTag}
            onClick={() => {
              setTagInput("");
              updateParam("tag", "");
            }}
          >
            Clear tag ×
          </button>
        )}
      </form>
    </div>
  );
}
