import { formatSantimAsBirr } from "@habeshalive/shared";
import { redirect } from "next/navigation";
import { AppealsQueue } from "@/components/admin/AppealsQueue";
import { BoostsQueue } from "@/components/admin/BoostsQueue";
import { ModerationQueue } from "@/components/admin/ModerationQueue";
import { PayoutsQueue } from "@/components/admin/PayoutsQueue";
import { ReportsQueue } from "@/components/admin/ReportsQueue";
import { BottomNav } from "@/components/BottomNav";
import { StatCard } from "@/components/StatCard";
import { TopNav } from "@/components/TopNav";
import {
  getActiveBoosts,
  getAdminSummary,
  getAppeals,
  getCurrentUser,
  getModerationQueue,
  getPendingPayouts,
  getReports,
} from "@/lib/api";
import { GRAFANA_URL } from "@/lib/config";
import styles from "./page.module.css";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin");
  if (user.role !== "admin") redirect("/");

  const [summary, payouts, moderationFlags, reports, appeals, boosts] = await Promise.all([
    getAdminSummary(),
    getPendingPayouts(),
    getModerationQueue(),
    getReports(),
    getAppeals(),
    getActiveBoosts(),
  ]);

  return (
    <>
      <TopNav isAuthed />
      <main className={styles.main}>
        <h1 className={styles.heading}>Admin</h1>

        {summary && (
          <div className={styles.summaryGrid}>
            <StatCard label="Pending payouts" value={String(summary.pendingPayouts)} />
            <StatCard label="Flagged content" value={String(summary.pendingModerationFlags)} />
            <StatCard label="Open reports" value={String(summary.pendingReports)} />
            <StatCard label="Pending appeals" value={String(summary.pendingAppeals)} />
            <StatCard label="Live streams" value={String(summary.liveStreams)} />
            <StatCard label="Total users" value={String(summary.totalUsers)} />
            <StatCard label="Creators" value={String(summary.totalCreators)} />
            <StatCard label="Gift volume" value={formatSantimAsBirr(summary.giftVolumeSantim)} />
            <StatCard label="Active subscriptions" value={String(summary.activeSubscriptions)} />
            <StatCard label="MRR" value={formatSantimAsBirr(summary.mrrSantim)} />
            <StatCard label="Boost revenue" value={formatSantimAsBirr(summary.boostRevenueSantim)} />
          </div>
        )}

        <a href={GRAFANA_URL} target="_blank" rel="noreferrer" className={styles.grafanaLink}>
          Open Grafana for detailed metrics →
        </a>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Payouts awaiting review</h2>
          <PayoutsQueue items={payouts} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Active boosts</h2>
          <BoostsQueue items={boosts} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Flagged content</h2>
          <ModerationQueue items={moderationFlags} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Reports</h2>
          <ReportsQueue items={reports} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appeals</h2>
          <AppealsQueue items={appeals} />
        </section>
      </main>
      <BottomNav />
    </>
  );
}
