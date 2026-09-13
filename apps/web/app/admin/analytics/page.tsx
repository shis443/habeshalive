import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard";
import { getAnalyticsOverview, getAnalyticsWindowOptions } from "@/lib/api";
import styles from "../page.module.css";

export default async function AdminAnalyticsPage() {
  const [overview, windowOptions] = await Promise.all([getAnalyticsOverview(), getAnalyticsWindowOptions()]);

  return (
    <>
      <h1 className={styles.heading}>Analytics</h1>
      <p className={styles.subtext}>
        Trailing 30 days vs. the 30 days before that. Sourced from the revenue_daily rollup, not a live ledger scan —
        gross/net figures may lag today&apos;s activity by up to 6 hours until the nightly recompute catches up.
      </p>
      {overview ? (
        <AnalyticsDashboard overview={overview} windowOptions={windowOptions} />
      ) : (
        <p className={styles.subtext}>Analytics data isn&apos;t available right now.</p>
      )}
    </>
  );
}
