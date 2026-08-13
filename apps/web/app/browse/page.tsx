import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { BrowseFilterBar } from "@/components/BrowseFilterBar";
import { CategoryRowCompact } from "@/components/reference/CategoryRowCompact";
import { UnderlineTabs } from "@/components/reference/UnderlineTabs";
import { LiveChannelsGrid } from "@/components/LiveChannelsGrid";
import { TopNav } from "@/components/TopNav";
import { getCategories, getCurrentUser, getLiveStreams, type LiveStreamSort } from "@/lib/api";
import styles from "./page.module.css";

const VALID_SORTS = new Set(["birqRank", "viewers", "recent", "alphabetical"]);

// Flutter-reference UI rebuild — browse.dart is the literal spec here:
// 40px bold title, underline TabBar (Categories then Live Channels, in
// that order), Categories view as compact rows (categories_tile_small),
// Live Channels view as the large feed card (live_tile_large). See
// docs/FLUTTER_UI_REBUILD_AUDIT.md for the exact extracted values and
// docs/FLUTTER_UI_REBUILD_PLAN.md for why LiveChannelsSidebar is dropped
// from this page specifically (redundant with the page's own Live
// Channels tab; the reference has no side-list concept at all).
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

  const [user, categories, streams] = await Promise.all([
    getCurrentUser(),
    view === "categories" ? getCategories() : Promise.resolve([]),
    view === "channels"
      ? getLiveStreams({ category: category || undefined, language: language || undefined, tag: tag || undefined, sort })
      : Promise.resolve([]),
  ]);

  function tabHref(nextView: "categories" | "channels") {
    const p = new URLSearchParams();
    p.set("view", nextView);
    return `/browse?${p.toString()}`;
  }

  return (
    <>
      <TopNav isAuthed={!!user} />
      <main className={styles.main}>
        <div className={styles.headerRow}>
          <h1 className={styles.heading}>Browse</h1>
          {/* Browse ("I know what I want, filter it") and Discover ("show
              me something") are explicit siblings in this app's IA, not a
              tab switch within the same page — a real nav link to the
              other one. */}
          <Link href="/discover" className={styles.discoverLink}>
            Discover →
          </Link>
        </div>
        <UnderlineTabs
          tabs={[
            { label: "Categories", href: tabHref("categories"), active: view === "categories" },
            { label: "Live Channels", href: tabHref("channels"), active: view === "channels" },
          ]}
        />

        {view === "categories" ? (
          <div className={styles.categoryList}>
            {categories.map((cat) => (
              <CategoryRowCompact key={cat.id} category={cat} />
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
