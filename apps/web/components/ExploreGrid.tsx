"use client";

import type { LiveStream } from "@habeshalive/shared";
import { useMemo, useState } from "react";
import { CategoryPills } from "./CategoryPills";
import { StreamCard } from "./StreamCard";
import styles from "@/app/page.module.css";

// Holds selectedCategory client-side and filters a stream list fetched once
// server-side (see app/page.tsx) — avoids refetching on every pill click.
export function ExploreGrid({ streams }: { streams: LiveStream[] }) {
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filteredStreams = useMemo(() => {
    if (selectedCategory === "all") return streams;
    return streams.filter((stream) => stream.category?.toLowerCase() === selectedCategory.toLowerCase());
  }, [streams, selectedCategory]);

  return (
    <>
      <CategoryPills selected={selectedCategory} onSelect={setSelectedCategory} />
      <h2 className={styles.heading}>Live on Birq</h2>
      {filteredStreams.length === 0 ? (
        <p className={styles.empty}>
          {streams.length === 0
            ? "No one is live right now. Check back soon."
            : "No one is live in this category right now."}
        </p>
      ) : (
        <div className={styles.grid}>
          {filteredStreams.map((stream) => (
            <StreamCard key={stream.id} stream={stream} />
          ))}
        </div>
      )}
    </>
  );
}
