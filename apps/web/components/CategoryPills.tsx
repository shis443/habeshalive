"use client";

import styles from "./CategoryPills.module.css";

const CATEGORIES = ["All", "Music", "Gaming", "Traditional", "Just Chatting"];

// "All" maps to the "all" sentinel value ExploreGrid uses to mean
// "no filter" — every other pill's value is its own label. stream.category
// is free-form text (VARCHAR(50), no enum/CHECK constraint — see
// db/migrations/0001_init.sql), so ExploreGrid compares case-insensitively
// rather than assuming creators enter this exact casing.
export function CategoryPills({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (category: string) => void;
}) {
  return (
    <div className={styles.scroll}>
      {CATEGORIES.map((category) => {
        const value = category === "All" ? "all" : category;
        const isActive = value.toLowerCase() === selected.toLowerCase();
        return (
          <button
            key={category}
            type="button"
            className={isActive ? styles.pillActive : styles.pill}
            aria-pressed={isActive}
            onClick={() => onSelect(value)}
          >
            {category}
          </button>
        );
      })}
    </div>
  );
}
