"use client";

import { useEffect, useState } from "react";
import { unwrapClientData } from "@/lib/clientApi";
import styles from "./StreamTagsInput.module.css";

const MAX_TAGS = 5;

export function StreamTagsInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (input.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/backend/streams/tags/search?q=${encodeURIComponent(input.trim())}`, { signal: controller.signal })
      .then((res) => (res.ok ? unwrapClientData<string[]>(res) : []))
      .then((names) => setSuggestions(names.filter((n) => !tags.includes(n))))
      .catch(() => {});
    return () => controller.abort();
  }, [input, tags]);

  function addTag(raw: string) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized || tags.includes(normalized) || tags.length >= MAX_TAGS) return;
    onChange([...tags, normalized]);
    setInput("");
    setSuggestions([]);
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.chips}>
        {tags.map((tag) => (
          <span key={tag} className={styles.chip}>
            {tag}
            <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      {tags.length < MAX_TAGS && (
        <div className={styles.inputWrap}>
          <input
            type="text"
            className={styles.input}
            placeholder="Add a tag..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag(input);
              }
            }}
          />
          {suggestions.length > 0 && (
            <div className={styles.suggestions}>
              {suggestions.map((s) => (
                <button key={s} type="button" className={styles.suggestion} onClick={() => addTag(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
