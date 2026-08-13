import { STREAM_CATEGORIES } from "@birq/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { CategoryClipsGrid } from "@/components/CategoryClipsGrid";
import { CategoryFollowButton } from "@/components/CategoryFollowButton";
import { CategoryVodsGrid } from "@/components/CategoryVodsGrid";
import { LiveChannelsSidebar } from "@/components/LiveChannelsSidebar";
import { StreamCard } from "@/components/StreamCard";
import { TopNav } from "@/components/TopNav";
import {
  getCategoryFollowStatus,
  getClipsByCategory,
  getCurrentUser,
  getLiveStreams,
  getVodsByCategory,
} from "@/lib/api";
import { formatViewerCount } from "@/lib/format";
import styles from "./page.module.css";

type CategoryTab = "live" | "videos" | "clips";

// Phase 3.3 — the destination /browse's category tiles never had. slug is
// the category name itself, URL-decoded (STREAM_CATEGORIES is a short,
// fixed 4-value list — "Just Chatting" included — not a separate slug
// scheme), matching how /browse's own categoryHref already links
// (?category=<name>) rather than inventing kebab-case slugs that would
// need a mapping layer neither side has today.
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const category = decodeURIComponent(slug);
  if (!(STREAM_CATEGORIES as readonly string[]).includes(category)) {
    return notFound();
  }

  const rawTab = (await searchParams).tab;
  const tab: CategoryTab = rawTab === "videos" || rawTab === "clips" ? rawTab : "live";

  // categoryLiveStreams (unlike vods/clips below) is always fetched,
  // regardless of the active tab — the header's "N watching now" stat
  // needs a real, current count on every tab, not just while the Live tab
  // happens to be selected. Reused as-is for the grid when tab === "live",
  // same call, no second fetch.
  const [user, sidebarStreams, categoryLiveStreams, vods, clips, followStatus] = await Promise.all([
    getCurrentUser(),
    getLiveStreams(),
    getLiveStreams({ category }),
    tab === "videos" ? getVodsByCategory(category) : Promise.resolve([]),
    tab === "clips" ? getClipsByCategory(category) : Promise.resolve([]),
    getCategoryFollowStatus(category),
  ]);
  const liveViewerCount = categoryLiveStreams.reduce((sum, stream) => sum + stream.viewerCount, 0);

  function tabHref(next: CategoryTab) {
    return next === "live" ? `/category/${encodeURIComponent(category)}` : `/category/${encodeURIComponent(category)}?tab=${next}`;
  }

  return (
    <>
      <TopNav isAuthed={!!user} />
      <LiveChannelsSidebar streams={sidebarStreams} />
      <main className={styles.main}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.heading}>{category}</h1>
            <p className={styles.stats}>
              {liveViewerCount > 0 ? `${formatViewerCount(liveViewerCount)} watching now` : "No one watching right now"}
              <span className={styles.statsDot} aria-hidden="true" />
              {formatViewerCount(followStatus.followerCount)} {followStatus.followerCount === 1 ? "follower" : "followers"}
            </p>
          </div>
          <CategoryFollowButton category={category} isAuthed={!!user} initialFollowing={followStatus.following} />
        </div>
        <div className={styles.tabs}>
          <Link href={tabHref("live")} className={tab === "live" ? styles.tabActive : styles.tab}>
            Live Channels
          </Link>
          <Link href={tabHref("videos")} className={tab === "videos" ? styles.tabActive : styles.tab}>
            Videos
          </Link>
          <Link href={tabHref("clips")} className={tab === "clips" ? styles.tabActive : styles.tab}>
            Clips
          </Link>
        </div>

        {tab === "live" &&
          (categoryLiveStreams.length === 0 ? (
            <p className={styles.empty}>No one is streaming {category} right now.</p>
          ) : (
            <div className={styles.grid}>
              {categoryLiveStreams.map((stream) => (
                <StreamCard key={stream.id} stream={stream} />
              ))}
            </div>
          ))}
        {tab === "videos" && <CategoryVodsGrid vods={vods} />}
        {tab === "clips" && <CategoryClipsGrid clips={clips} />}
      </main>
      <BottomNav active="explore" />
    </>
  );
}
