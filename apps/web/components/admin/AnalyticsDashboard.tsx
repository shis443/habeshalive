"use client";

import { formatSantimAsBirr, type AnalyticsOverview, type LeaderboardBoardValue, type LeaderboardRow, type WindowOption } from "@birq/shared";
import { useEffect, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { SimpleLineChart, type ChartSeries } from "./SimpleLineChart";
import styles from "./AnalyticsDashboard.module.css";

const BOARD_LABELS: Record<LeaderboardBoardValue, string> = {
  top_gifters: "Top gifters",
  top_streamers_revenue: "Top streamers — revenue",
  top_streamers_watchtime: "Top streamers — watch time",
  top_streamers_ccu: "Top streamers — peak viewers",
};

function formatBoardValue(board: LeaderboardBoardValue, value: number): string {
  if (board === "top_gifters" || board === "top_streamers_revenue") return formatSantimAsBirr(value);
  if (board === "top_streamers_watchtime") {
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  return `${value} viewers`;
}

// null when previous is 0 — "+infinite%" is not a useful number to show.
function deltaPct(current: number, previous: number): string | undefined {
  if (previous === 0) return current === 0 ? undefined : "new";
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}% vs prior period`;
}

export function AnalyticsDashboard({
  overview,
  windowOptions,
}: {
  overview: AnalyticsOverview;
  windowOptions: WindowOption[];
}) {
  const [board, setBoard] = useState<LeaderboardBoardValue>("top_gifters");
  const [windowIndex, setWindowIndex] = useState(0);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const option = windowOptions[windowIndex];
    if (!option) return;
    setLoading(true);
    fetch(
      `/api/backend/admin/analytics/leaderboard?board=${board}&windowKind=${option.windowKind}&windowStart=${option.windowStart}`
    )
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setRows(body.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [board, windowIndex, windowOptions]);

  const { current, previous } = overview;

  const grossSeries: ChartSeries[] = [
    { label: "Gross", color: "var(--primary)", points: overview.dailySeries.map((p) => ({ x: p.day, y: p.grossSantim / 100 })) },
    { label: "Net", color: "var(--secondary)", points: overview.dailySeries.map((p) => ({ x: p.day, y: p.netSantim / 100 })) },
  ];
  const ccuSeries: ChartSeries[] = [
    { label: "Peak viewers", color: "var(--tertiary, var(--primary))", points: overview.ccuCurve.map((p) => ({ x: p.day, y: p.peakViewers })) },
  ];

  return (
    <>
      <div className={styles.grid}>
        <StatCard label="Gross (30d)" value={formatSantimAsBirr(current.grossSantim)} delta={deltaPct(current.grossSantim, previous.grossSantim)} />
        <StatCard label="Net (30d)" value={formatSantimAsBirr(current.netSantim)} delta={deltaPct(current.netSantim, previous.netSantim)} />
        <StatCard label="ARPU" value={formatSantimAsBirr(current.arpuSantim)} delta={deltaPct(current.arpuSantim, previous.arpuSantim)} />
        <StatCard label="ARPPU" value={formatSantimAsBirr(current.arppuSantim)} delta={deltaPct(current.arppuSantim, previous.arppuSantim)} />
        <StatCard label="Conversion" value={`${current.conversionPct.toFixed(1)}%`} delta={deltaPct(current.conversionPct, previous.conversionPct)} />
        <StatCard label="Active streamers" value={String(current.activeStreamers)} delta={deltaPct(current.activeStreamers, previous.activeStreamers)} />
        <StatCard label="Active users" value={String(current.activeUsers)} delta={deltaPct(current.activeUsers, previous.activeUsers)} />
        <StatCard label="Paying users" value={String(current.payingUsers)} delta={deltaPct(current.payingUsers, previous.payingUsers)} />
      </div>

      <div className={styles.chartCard}>
        <p className={styles.chartTitle}>Daily gross / net (ETB)</p>
        <SimpleLineChart series={grossSeries} valueFormatter={(v) => v.toLocaleString()} />
      </div>

      <div className={styles.chartCard}>
        <p className={styles.chartTitle}>Peak concurrent viewers, platform-wide</p>
        <SimpleLineChart series={ccuSeries} />
      </div>

      <div className={styles.switcherRow}>
        <select value={board} onChange={(e) => setBoard(e.target.value as LeaderboardBoardValue)}>
          {Object.entries(BOARD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={windowIndex} onChange={(e) => setWindowIndex(Number(e.target.value))}>
          {windowOptions.map((option, i) => (
            <option key={`${option.windowKind}-${option.windowStart}`} value={i}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.leaderboardList}>
        {loading && <p className={styles.chartTitle}>Loading…</p>}
        {!loading && rows.length === 0 && <p className={styles.chartTitle}>No activity for this board and window yet.</p>}
        {!loading &&
          rows.map((row) => (
            <div key={row.subjectId} className={styles.leaderboardRow}>
              <span className={styles.rank}>#{row.rank}</span>
              <span className={styles.name}>{row.displayName || row.username}</span>
              <span className={styles.value}>{formatBoardValue(board, row.value)}</span>
            </div>
          ))}
      </div>
    </>
  );
}
