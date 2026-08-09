import type { LiveStream, ServedAd } from "@birq/shared";
import { CategoryPills } from "./CategoryPills";
import { SponsoredStreamCard } from "./SponsoredStreamCard";
import { StreamCard } from "./StreamCard";
import styles from "@/app/page.module.css";

// streams arrives pre-filtered by category from the server (see
// app/page.tsx) — this just renders what it's given plus the pills that
// navigate to a new ?category= value.
export function ExploreGrid({
  streams,
  selectedCategory,
  sponsoredCard,
}: {
  streams: LiveStream[];
  selectedCategory: string;
  sponsoredCard: ServedAd | null;
}) {
  return (
    <>
      <CategoryPills selected={selectedCategory} />
      <h2 className={styles.heading}>Live on Birq</h2>
      {streams.length === 0 && !sponsoredCard ? (
        <p className={styles.empty}>
          {selectedCategory === "all"
            ? "No one is live right now. Check back soon."
            : "No one is live in this category right now."}
        </p>
      ) : (
        <div className={styles.grid}>
          {/* Third slot, not first — a sponsored card leading the grid
              reads as an ad wall before a viewer sees anyone real is live;
              a few real cards first, then the placement. */}
          {streams.slice(0, 2).map((stream) => (
            <StreamCard key={stream.id} stream={stream} />
          ))}
          {sponsoredCard && <SponsoredStreamCard ad={sponsoredCard} />}
          {streams.slice(2).map((stream) => (
            <StreamCard key={stream.id} stream={stream} />
          ))}
        </div>
      )}
    </>
  );
}
