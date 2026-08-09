import { BottomNavSkeleton, HeaderSkeleton } from "@/components/PageChromeSkeleton";
import { Skeleton } from "@/components/Skeleton";
import layoutStyles from "./layout.module.css";
import styles from "./loading.module.css";

// Covers every /dashboard/* route (Next re-shows this for a segment's own
// loading whenever a more specific loading.tsx isn't present deeper in
// the tree — none of the subpages have their own) — deliberately generic
// content shape (heading + a couple of card blocks) rather than matching
// Home's exact stat-grid/checklist layout, since this same skeleton also
// covers Stream Manager, Content, Moderation, etc.
export default function DashboardLoading() {
  return (
    <>
      <HeaderSkeleton />
      <div className={layoutStyles.shell}>
        <div className={styles.sidebar}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className={styles.navRow}>
              <Skeleton style={{ width: 20, height: 20 }} />
              <Skeleton style={{ height: 13 }} className={styles.navRowText} />
            </div>
          ))}
        </div>
        <main className={layoutStyles.content}>
          <Skeleton style={{ width: 200, height: 28, marginBottom: 8 }} />
          <Skeleton style={{ width: 320, height: 14, marginBottom: 24 }} />
          <div className={styles.card}>
            <Skeleton style={{ width: 140, height: 16 }} />
            <Skeleton style={{ width: "100%", height: 60 }} />
          </div>
          <div className={styles.card}>
            <Skeleton style={{ width: 140, height: 16 }} />
            <Skeleton style={{ width: "100%", height: 60 }} />
          </div>
        </main>
      </div>
      <BottomNavSkeleton />
    </>
  );
}
