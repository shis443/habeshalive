import { STREAM_CATEGORIES } from "@habeshalive/shared";
import styles from "./RecentCategoriesPlaceholder.module.css";

// Real category names (the platform's actual fixed taxonomy — see
// packages/shared/src/constants.ts, same list CategoryPills.tsx uses),
// but NOT real "this creator's recently streamed categories" data —
// nothing tracks per-creator category history anywhere in this codebase.
// Showing the real category names rather than fake ones avoids inventing
// data that doesn't exist, but the "coming soon" label and dashed
// styling still make clear this specific section (a personalized recent-
// history view) isn't functional yet — unlike Clips just above it on the
// Home tab (see FeaturedClips.tsx), which is real as of Module 4.
export function RecentCategoriesPlaceholder({ displayName }: { displayName: string }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{displayName}&apos;s recently streamed Categories</h2>
      <div className={styles.row}>
        {STREAM_CATEGORIES.map((category) => (
          <div key={category} className={styles.card}>
            <span className={styles.label}>{category}</span>
          </div>
        ))}
      </div>
      <p className={styles.note}>Category history isn't tracked yet — coming in a future update.</p>
    </section>
  );
}
