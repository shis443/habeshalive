import { BottomNavSkeleton, HeaderSkeleton } from "@/components/PageChromeSkeleton";
import { Skeleton } from "@/components/Skeleton";
import chromeStyles from "./loading.module.css";
import pageStyles from "./page.module.css";

// Matches ExplorePage's real shape (app/page.tsx): fixed header, fixed
// live-channels sidebar (240px, desktop-only — same breakpoint as
// LiveChannelsSidebar.module.css), and a grid of stream-card-shaped
// blocks using page.module.css's own real .main/.grid classes so the
// column count and gaps line up exactly with what replaces them.
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className={chromeStyles.sidebar}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={chromeStyles.sidebarRow}>
            <Skeleton style={{ width: 28, height: 28 }} circle />
            <Skeleton style={{ height: 12 }} className={chromeStyles.sidebarRowText} />
          </div>
        ))}
      </div>
      <main className={pageStyles.main}>
        <Skeleton style={{ width: 260, height: 32, marginTop: 8 }} />
        <Skeleton style={{ width: 180, height: 26, margin: "24px 0 16px" }} />
        <div className={pageStyles.grid}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={chromeStyles.card}>
              <Skeleton style={{ aspectRatio: "16 / 9", borderRadius: 8, width: "100%" }} />
              <Skeleton style={{ width: "80%", height: 15 }} />
              <Skeleton style={{ width: "50%", height: 13 }} />
            </div>
          ))}
        </div>
      </main>
      <BottomNavSkeleton />
    </>
  );
}
