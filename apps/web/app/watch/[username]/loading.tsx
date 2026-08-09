import { BottomNavSkeleton, HeaderSkeleton } from "@/components/PageChromeSkeleton";
import { Skeleton } from "@/components/Skeleton";
import chatStyles from "./loading.module.css";
import pageStyles from "./page.module.css";

// Approximates the LIVE layout (player + chat side by side on desktop) —
// this page also has offline/nonexistent-username branches with a
// different shape, but a live visit is the common case a shared username
// URL actually gets clicked for, and Next shows this for all three branches
// equally since it can't know which one a given request will resolve to
// until the data fetch completes.
export default function WatchLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className={pageStyles.main}>
        <div className={pageStyles.playerColumn}>
          <Skeleton style={{ aspectRatio: "16 / 9", width: "100%", borderRadius: 0 }} />
          <div className={pageStyles.body}>
            <div className={chatStyles.metaRow} style={{ padding: "16px 0" }}>
              <Skeleton style={{ width: 48, height: 48 }} circle />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <Skeleton style={{ width: "60%", height: 18 }} />
                <Skeleton style={{ width: "35%", height: 13 }} />
              </div>
            </div>
          </div>
        </div>
        <div className={pageStyles.chatColumn}>
          <div className={chatStyles.chatHeader}>
            <Skeleton style={{ width: 90, height: 14 }} />
            <Skeleton style={{ width: 24, height: 24 }} circle />
          </div>
          <div className={chatStyles.chatMessages}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} style={{ width: `${60 + ((i * 13) % 35)}%`, height: 13 }} />
            ))}
          </div>
        </div>
      </div>
      <BottomNavSkeleton />
    </>
  );
}
