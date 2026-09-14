import Link from "next/link";
import { AnalyticsCharts } from "@/components/AnalyticsCharts";
import { TierProgressCard } from "@/components/TierProgressCard";
import { getCreatorAnalytics, getCreatorTier, getCurrentUser } from "@/lib/api";
import styles from "../page.module.css";
import windowStyles from "./analytics.module.css";
import type { CreatorAnalyticsWindow } from "@birq/shared";

const WINDOWS: { value: CreatorAnalyticsWindow; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  const rawWindow = (await searchParams).window;
  const window: CreatorAnalyticsWindow =
    rawWindow === "30d" || rawWindow === "90d" ? rawWindow : "7d";

  const [analytics, tier] = await Promise.all([getCreatorAnalytics(window), getCreatorTier()]);

  return (
    <>
      <h1 className={styles.heading}>Analytics</h1>
      <p className={styles.subtext}>Viewers, watch hours, and revenue for your channel.</p>

      {tier && <TierProgressCard tier={tier} />}

      <div className={windowStyles.windowRow}>
        {WINDOWS.map((w) => (
          <Link
            key={w.value}
            href={`/dashboard/analytics?window=${w.value}`}
            className={`${windowStyles.windowTab} ${window === w.value ? windowStyles.windowTabActive : ""}`}
          >
            {w.label}
          </Link>
        ))}
      </div>

      {analytics ? (
        <AnalyticsCharts analytics={analytics} />
      ) : (
        <p className={styles.subtext}>Couldn&apos;t load analytics right now.</p>
      )}
    </>
  );
}
