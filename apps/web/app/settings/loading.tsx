import { BottomNavSkeleton, HeaderSkeleton } from "@/components/PageChromeSkeleton";
import { Skeleton } from "@/components/Skeleton";
import cardStyles from "@/app/dashboard/loading.module.css";
import tabStyles from "@/components/SettingsTabs.module.css";
import pageStyles from "./page.module.css";

export default function SettingsLoading() {
  return (
    <>
      <HeaderSkeleton />
      <main className={pageStyles.main}>
        <Skeleton style={{ width: 140, height: 28, marginBottom: 20 }} />
        <div className={tabStyles.tabBar}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} style={{ width: 70, height: 16, margin: "10px 0" }} />
          ))}
        </div>
        <div className={cardStyles.card}>
          <Skeleton style={{ width: 100, height: 15 }} />
          <Skeleton style={{ width: "100%", height: 36 }} />
        </div>
        <div className={cardStyles.card}>
          <Skeleton style={{ width: 100, height: 15 }} />
          <Skeleton style={{ width: "100%", height: 36 }} />
        </div>
      </main>
      <BottomNavSkeleton />
    </>
  );
}
