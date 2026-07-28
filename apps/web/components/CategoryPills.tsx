import { STREAM_CATEGORIES } from "@habeshalive/shared";
import Link from "next/link";
import styles from "./CategoryPills.module.css";

const CATEGORIES = ["All", ...STREAM_CATEGORIES];

// Real navigation, not a visual-only active state: each pill links to
// ?category=<value>, which app/page.tsx reads server-side and asks the API
// to actually filter by (see streams/service.ts's listLiveStreams) — a
// shareable/bookmarkable URL, and no over-fetching every live stream just
// to filter client-side as the list grows.
export function CategoryPills({ selected }: { selected: string }) {
  return (
    <div className={styles.scroll}>
      {CATEGORIES.map((category) => {
        const value = category === "All" ? "all" : category;
        const isActive = value.toLowerCase() === selected.toLowerCase();
        const href = value === "all" ? "/" : `/?category=${encodeURIComponent(value)}`;
        return (
          <Link
            key={category}
            href={href}
            className={isActive ? styles.pillActive : styles.pill}
            aria-pressed={isActive}
          >
            {category}
          </Link>
        );
      })}
    </div>
  );
}
