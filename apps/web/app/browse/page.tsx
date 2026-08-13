import { STREAM_CATEGORIES } from "@birq/shared";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { BrowseFilterBar } from "@/components/BrowseFilterBar";
import { CategoryTile } from "@/components/CategoryTile";
import { LiveChannelsGrid } from "@/components/LiveChannelsGrid";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getLiveStreams, type LiveStreamSort } from "@/lib/api";
import styles from "./page.module.css";

const VALID_SORTS = new Set(["birqRank", "viewers", "recent", "alphabetical"]);

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    category?: string;
    language?: string;
    tag?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const view = params.view === "channels" ? "channels" : "categories";
  const category = params.category ?? "";
  const language = params.language ?? "";
  const tag = params.tag ?? "";
  const sort = VALID_SORTS.has(params.sort ?? "") ? (params.sort as LiveStreamSort) : "birqRank";

  const [user, allStreams, streams] = await Promise.all([
    getCurrentUser(),
    getLiveStreams(),
    view === "channels"
      ? getLiveStreams({ category: category || undefined, language: language || undefined, tag: tag || undefined, sort })
      : Promise.resolve([]),
  ]);

  function tabHref(nextView: "categories" | "channels") {
    const p = new URLSearchParams();
    p.set("view", nextView);
    return `/browse?${p.toString()}`;
  }

  // Real per-category live-viewer totals, computed from allStreams (already
  // fetched above for the sidebar) — no second API call, and no fake count.
  const liveViewersByCategory = new Map<string, number>();
  for (const stream of allStreams) {
    if (!stream.category) continue;
    liveViewersByCategory.set(stream.category, (liveViewersByCategory.get(stream.category) ?? 0) + stream.viewerCount);
  }

  // Phase 3.3 — category tiles now go to a real destination
  // (/category/[slug]'s Live/Videos/Clips tabs) instead of just filtering
  // this same page's Live Channels view. That filter itself is untouched
  // (BrowseFilterBar's own category-adjacent controls still work exactly
  // as before) — this only changes where clicking a category *tile*
  // lands.
  function categoryHref(cat: string) {
    return `/category/${encodeURIComponent(cat)}`;
  }

  return (
    <>
      <TopNav isAuthed={!!user} />
      <LiveChannelsSidebar streams={allStreams} />
      <main className={styles.main}>
        <div className={styles.headerRow}>
          <h1 className={styles.heading}>Browse</h1>
          {/* Phase 3.6 — Browse ("I know what I want, filter it") and
              Discover ("show me something") are explicit siblings in the
              IA this app is modeling, not a tab switch within the same
              page — a real nav link to the other one, not a third tab
              here. */}
          <Link href="/discover" className={styles.discoverLink}>
            Discover →
          </Link>
        </div>
        <div className={styles.tabs}>
          <Link href={tabHref("categories")} className={view === "categories" ? styles.tabActive : styles.tab}>
            Categories
          </Link>
          <Link href={tabHref("channels")} className={view === "channels" ? styles.tabActive : styles.tab}>
            Live Channels
          </Link>
        </div>

        {view === "categories" ? (
          <div className={styles.categoryGrid}>
            {STREAM_CATEGORIES.map((cat) => (
              <CategoryTile
                key={cat}
                category={cat}
                href={categoryHref(cat)}
                liveViewerCount={liveViewersByCategory.get(cat)}
              />
            ))}
          </div>
        ) : (
          <>
            <BrowseFilterBar language={language} tag={tag} sort={sort} />
            {category && (
              <p className={styles.activeFilter}>
                Category: {category}{" "}
                <Link href={tabHref("channels")} className={styles.clearFilter}>
                  clear ×
                </Link>
              </p>
            )}
            <LiveChannelsGrid
              initialStreams={streams}
              category={category}
              language={language}
              tag={tag}
              sort={sort}
            />
          </>
        )}
      </main>
      <BottomNav active="explore" />
    </>
  );
}
