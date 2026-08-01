import { STREAM_CATEGORIES } from "@habeshalive/shared";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { BrowseFilterBar } from "@/components/BrowseFilterBar";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
import { StreamCard } from "@/components/StreamCard";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getLiveStreams, type LiveStreamSort } from "@/lib/api";
import styles from "./page.module.css";

const VALID_SORTS = new Set(["viewers", "recent", "alphabetical"]);

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
  const sort = VALID_SORTS.has(params.sort ?? "") ? (params.sort as LiveStreamSort) : "viewers";

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

  function categoryHref(cat: string) {
    const p = new URLSearchParams({ view: "channels", category: cat });
    return `/browse?${p.toString()}`;
  }

  return (
    <>
      <TopNav isAuthed={!!user} />
      <LiveChannelsSidebar streams={allStreams} />
      <main className={styles.main}>
        <h1 className={styles.heading}>Browse</h1>
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
              <Link key={cat} href={categoryHref(cat)} className={styles.categoryTile}>
                {cat}
              </Link>
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
            {streams.length === 0 ? (
              <p className={styles.empty}>No live streams match these filters right now.</p>
            ) : (
              <div className={styles.grid}>
                {streams.map((stream) => (
                  <StreamCard key={stream.id} stream={stream} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <BottomNav active="explore" />
    </>
  );
}
