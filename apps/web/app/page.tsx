import { BottomNav } from "@/components/BottomNav";
import { ExploreGrid } from "@/components/ExploreGrid";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getLiveStreams } from "@/lib/api";
import styles from "./page.module.css";

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  // The sidebar always shows every live channel regardless of the grid's
  // category filter (it's a persistent "who's live" list, not scoped to
  // the pill selection) — only re-fetch a second, filtered list when a
  // category is actually selected, so the common "All" case stays one call.
  const [allStreams, filteredStreams, user] = await Promise.all([
    getLiveStreams(),
    category ? getLiveStreams(category) : Promise.resolve(null),
    getCurrentUser(),
  ]);
  const gridStreams = filteredStreams ?? allStreams;

  return (
    <>
      <TopNav isAuthed={!!user} />
      <LiveChannelsSidebar streams={allStreams} />
      <main className={styles.main}>
        <ExploreGrid streams={gridStreams} selectedCategory={category ?? "all"} />
      </main>
      <BottomNav active="explore" />
    </>
  );
}
