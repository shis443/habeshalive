import { STREAM_CATEGORIES } from "@birq/shared";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { CategoryClipsGrid } from "@/components/CategoryClipsGrid";
import { CategoryTile } from "@/components/CategoryTile";
import { CategoryVodsGrid } from "@/components/CategoryVodsGrid";
import { FeaturedLiveRail } from "@/components/FeaturedLiveRail";
import LiveCardMedium from "@/components/reference/LiveCardMedium";
import CategoryRailCard from "@/components/reference/CategoryRailCard";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getLiveStreams, getTrendingClips, getTrendingVods, getCategories } from "@/lib/api";
import styles from "./page.module.css";

// Phase 3.6 — the "show me something" surface Twitch's IA splits from
// Browse ("I know what I want, filter it"). The home page doesn't serve
// this: it's a live-now grid, sorted, not curated. "Recommended For You"
// (personalized) stays deferred — there's still no usage/watch-history
// data to train it on — but the two signals this platform genuinely
// already has didn't need that data at all: boosted streams
// (stream_boosts — a creator or the platform paying to be surfaced is a
// real, existing "promote this" signal, not a new curation mechanism),
// and recency-weighted view counts on VODs/clips (real numbers, not a
// placeholder — see listTrendingVods/listTrendingClips's own 14/30-day
// windows on why this is "trending", not "all-time popular").
export default async function DiscoverPage() {
  const [user, allStreams, trendingVods, trendingClips, categories] = await Promise.all([
    getCurrentUser(),
    getLiveStreams({ sort: "birqRank" }),
    getTrendingVods(),
    getTrendingClips(),
    getCategories(),
  ]);
  const recommendedLive = allStreams.slice(0, 12);

  // Real per-category live-viewer totals from the same allStreams call
  // already made above for the sidebar — no second fetch, matches
  // /browse's identical computation for its Categories tab.
  const liveViewersByCategory = new Map<string, number>();
  for (const stream of allStreams) {
    if (!stream.category) continue;
    liveViewersByCategory.set(stream.category, (liveViewersByCategory.get(stream.category) ?? 0) + stream.viewerCount);
  }

  return (
    <>
      <TopNav isAuthed={!!user} />
      <main className={styles.main}>
        <h1 className={styles.heading}>Discover</h1>

        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>RECOMMENDED LIVE CHANNELS</h2>
          <div className={styles.liveRail} role="list">
            {recommendedLive.map((s) => (
              <LiveCardMedium key={s.id} stream={s} />
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionHeading}>RECOMMENDED CATEGORIES</h2>
          <div className={styles.categoryRail}>
            {categories.map((cat) => (
              <CategoryRailCard key={cat.slug} category={cat} />
            ))}
          </div>
        </section>

        {trendingClips.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>Trending clips</h2>
            <CategoryClipsGrid clips={trendingClips} />
          </section>
        )}

        {trendingVods.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>Trending videos</h2>
            <CategoryVodsGrid vods={trendingVods} />
          </section>
        )}

        {recommendedLive.length === 0 && trendingVods.length === 0 && trendingClips.length === 0 && (
          <p className={styles.empty}>
            Nothing trending yet — check{" "}
            <Link href="/browse" className={styles.browseLink}>
              Browse
            </Link>{" "}
            for what's live right now.
          </p>
        )}
      </main>
      <BottomNav active="explore" />
    </>
  );
}
