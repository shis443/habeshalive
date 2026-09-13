"use client";

import type { LiveStream, ServedAd } from "@birq/shared";
import { useState } from "react";
import { CategoryPills } from "./CategoryPills";
import { SponsoredStreamCard } from "./SponsoredStreamCard";
import { StreamCard } from "./StreamCard";
import styles from "@/app/page.module.css";

// streams arrives pre-filtered by category from the server (see
// app/page.tsx). A client component (not purely presentational anymore)
// so Not Interested/Block can remove a card from the grid the instant
// they succeed, instead of waiting for the next full page load.
export function ExploreGrid({
  streams,
  selectedCategory,
  sponsoredCard,
  isAuthed,
}: {
  streams: LiveStream[];
  selectedCategory: string;
  sponsoredCard: ServedAd | null;
  isAuthed: boolean;
}) {
  const [dismissedCreatorIds, setDismissedCreatorIds] = useState<Set<string>>(new Set());
  const visibleStreams = streams.filter((stream) => !dismissedCreatorIds.has(stream.creator.id));

  function handleDismissed(creatorId: string) {
    setDismissedCreatorIds((prev) => new Set(prev).add(creatorId));
  }

  return (
    <>
      <CategoryPills selected={selectedCategory} />
      <h2 className={styles.heading}>Live on Birq</h2>
      {visibleStreams.length === 0 && !sponsoredCard ? (
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
          {visibleStreams.slice(0, 2).map((stream) => (
            <StreamCard key={stream.id} stream={stream} isAuthed={isAuthed} onDismissed={handleDismissed} />
          ))}
          {sponsoredCard && <SponsoredStreamCard ad={sponsoredCard} />}
          {visibleStreams.slice(2).map((stream) => (
            <StreamCard key={stream.id} stream={stream} isAuthed={isAuthed} onDismissed={handleDismissed} />
          ))}
        </div>
      )}
    </>
  );
}
