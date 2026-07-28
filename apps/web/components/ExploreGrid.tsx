import type { LiveStream } from "@habeshalive/shared";
import { CategoryPills } from "./CategoryPills";
import { StreamCard } from "./StreamCard";
import styles from "@/app/page.module.css";

// streams arrives pre-filtered by category from the server (see
// app/page.tsx) — this just renders what it's given plus the pills that
// navigate to a new ?category= value.
export function ExploreGrid({
  streams,
  selectedCategory,
}: {
  streams: LiveStream[];
  selectedCategory: string;
}) {
  return (
    <>
      <CategoryPills selected={selectedCategory} />
      <h2 className={styles.heading}>Live on Birq</h2>
      {streams.length === 0 ? (
        <p className={styles.empty}>
          {selectedCategory === "all"
            ? "No one is live right now. Check back soon."
            : "No one is live in this category right now."}
        </p>
      ) : (
        <div className={styles.grid}>
          {streams.map((stream) => (
            <StreamCard key={stream.id} stream={stream} />
          ))}
        </div>
      )}
    </>
  );
}
