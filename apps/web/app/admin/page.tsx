import { formatSantimAsBirr } from "@birq/shared";
import Link from "next/link";
import { ActionCard } from "@/components/admin/ActionCard";
import { StatCard } from "@/components/StatCard";
import { getAdminSummary } from "@/lib/api";
import { GRAFANA_URL } from "@/lib/config";
import styles from "./page.module.css";

export default async function AdminOverviewPage() {
  const summary = await getAdminSummary();

  return (
    <>
      <h1 className={styles.heading}>Overview</h1>

      {summary && (
        <>
          <div className={styles.actionGrid}>
            <ActionCard href="/admin/payouts" label="Pending payouts" count={summary.pendingPayouts} />
            <ActionCard href="/admin/moderation" label="Flagged content" count={summary.pendingModerationFlags} />
            <ActionCard href="/admin/moderation/reports" label="Open reports" count={summary.pendingReports} />
            <ActionCard href="/admin/moderation/appeals" label="Open appeals" count={summary.pendingAppeals} />
          </div>

          <h2 className={styles.sectionTitle}>Platform</h2>
          <div className={styles.summaryGrid}>
            <Link href="/admin/live-streams" className={styles.statLink}>
              <StatCard label="Live streams" value={String(summary.liveStreams)} />
            </Link>
            <StatCard label="Total users" value={String(summary.totalUsers)} />
            <StatCard label="Creators" value={String(summary.totalCreators)} />
            <StatCard label="Today's signups" value={String(summary.todaySignups)} />
            <StatCard label="Today's gift volume" value={formatSantimAsBirr(summary.todayGiftVolumeSantim)} />
            <StatCard label="Gift volume (all time)" value={formatSantimAsBirr(summary.giftVolumeSantim)} />
            <StatCard label="Active subscriptions" value={String(summary.activeSubscriptions)} />
            <StatCard label="MRR" value={formatSantimAsBirr(summary.mrrSantim)} />
            <StatCard label="Boost revenue" value={formatSantimAsBirr(summary.boostRevenueSantim)} />
          </div>
        </>
      )}

      <a href={GRAFANA_URL} target="_blank" rel="noreferrer" className={styles.grafanaLink}>
        Open Grafana for detailed metrics →
      </a>
    </>
  );
}
