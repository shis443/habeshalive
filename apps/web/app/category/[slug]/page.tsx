import { STREAM_CATEGORIES } from "@birq/shared";
import { notFound } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import CategoryHero from "@/components/reference/CategoryHero";
import { ClipFeedCard } from "@/components/reference/ClipFeedCard";
import { LiveCardLarge } from "@/components/reference/LiveCardLarge";
import { UnderlineTabs } from "@/components/reference/UnderlineTabs";
import { VodCardReference } from "@/components/reference/VodCardReference";
import { TopNav } from "@/components/TopNav";
import {
  getCategoryBySlug,
  getCategoryFollowStatus,
  getClipsByCategory,
  getCurrentUser,
  getLiveStreams,
  getVodsByCategory,
} from "@/lib/api";
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
  const [user, categoryLiveStreams, vods, clips, followStatus, categoryMeta] = await Promise.all([
    getCurrentUser(),
    getLiveStreams({ category }),
    tab === "videos" ? getVodsByCategory(category) : Promise.resolve([]),
    tab === "clips" ? getClipsByCategory(category) : Promise.resolve([]),
    getCategoryFollowStatus(category),
    getCategoryBySlug(category),
  ]);
  const liveViewerCount = categoryLiveStreams.reduce((sum, stream) => sum + stream.viewerCount, 0);
  if (!categoryMeta) return notFound();

  function tabHref(next: CategoryTab) {
    return next === "live" ? `/category/${encodeURIComponent(category)}` : `/category/${encodeURIComponent(category)}?tab=${next}`;
  }

  return (
    <>
      <TopNav isAuthed={!!user} />
      <main className={styles.main}>
        <CategoryHero
          category={categoryMeta}
          followerCount={followStatus.followerCount}
          liveViewerCount={liveViewerCount}
          isAuthed={!!user}
          initialFollowing={followStatus.following}
        />
        <UnderlineTabs
          tabs={[
            { label: "Live Channels", href: tabHref("live"), active: tab === "live" },
            { label: "Videos", href: tabHref("videos"), active: tab === "videos" },
            { label: "Clips", href: tabHref("clips"), active: tab === "clips" },
          ]}
        />

        {tab === "live" &&
          (categoryLiveStreams.length === 0 ? (
            <p className={styles.empty}>No one is streaming {category} right now.</p>
          ) : (
            <div className={styles.grid}>
              {categoryLiveStreams.map((stream) => (
                <LiveCardLarge key={stream.id} stream={stream} />
              ))}
            </div>
          ))}
        {tab === "videos" && (
          <div className={styles.grid}>
            {vods.map((vod) => (
              <VodCardReference key={vod.id} vod={vod} />
            ))}
          </div>
        )}
        {tab === "clips" && (
          <div className={styles.grid}>
            {clips.map((clip) => (
              <ClipFeedCard key={clip.id} clip={clip} />
            ))}
          </div>
        )}
      </main>
      <BottomNav active="explore" />
    </>
  );
}
