"use client";

import { formatSantimAsBirr, type CreatorAnalytics } from "@birq/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./AnalyticsCharts.module.css";

// Recharts renders its own SVG text — CSS variables aren't visible inside
// it, so the axis/tick colors below are the actual hex values behind
// --on-surface-variant/--outline-variant (app/globals.css's dark palette,
// this app's only theme — see PlatformConfigForm.tsx and siblings, none
// of which support light mode either).
const AXIS_COLOR = "#cbc3d7";
const GRID_COLOR = "#494454";
const PRIMARY_COLOR = "#d0bcff";
const SECONDARY_COLOR = "#4cd7f6";

function formatDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${month}/${date}`;
}

export function AnalyticsCharts({ analytics }: { analytics: CreatorAnalytics }) {
  const chartData = analytics.days.map((d) => ({
    day: formatDay(d.day),
    peakViewers: d.peakViewers,
    avgViewers: d.avgViewers,
    watchHours: d.watchHours,
    revenueBirr: d.revenueSantim / 100,
  }));

  return (
    <div className={styles.wrap}>
      <div className={styles.chartCard}>
        <h3 className={styles.chartTitle}>Concurrent viewers</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke={AXIS_COLOR} fontSize={12} />
            <YAxis stroke={AXIS_COLOR} fontSize={12} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#171f33", border: "1px solid #494454" }} />
            <Line type="monotone" dataKey="peakViewers" name="Peak" stroke={PRIMARY_COLOR} strokeWidth={2} dot={false} />
            <Line
              type="monotone"
              dataKey="avgViewers"
              name="Average"
              stroke={SECONDARY_COLOR}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartCard}>
        <h3 className={styles.chartTitle}>Watch hours</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke={AXIS_COLOR} fontSize={12} />
            <YAxis stroke={AXIS_COLOR} fontSize={12} />
            <Tooltip contentStyle={{ background: "#171f33", border: "1px solid #494454" }} />
            <Bar dataKey="watchHours" name="Hours" fill={PRIMARY_COLOR} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.chartCard}>
        <h3 className={styles.chartTitle}>Revenue (ETB / day)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke={AXIS_COLOR} fontSize={12} />
            <YAxis stroke={AXIS_COLOR} fontSize={12} />
            <Tooltip contentStyle={{ background: "#171f33", border: "1px solid #494454" }} />
            <Bar dataKey="revenueBirr" name="ETB" fill={SECONDARY_COLOR} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.breakdownCard}>
        <h3 className={styles.chartTitle}>Revenue by source</h3>
        {analytics.revenueByType.length === 0 ? (
          <p className={styles.empty}>No revenue in this window.</p>
        ) : (
          <ul className={styles.breakdownList}>
            {analytics.revenueByType.map((entry) => (
              <li key={entry.type} className={styles.breakdownRow}>
                <span className={styles.breakdownLabel}>{entry.type.replace(/_/g, " ")}</span>
                <span className={styles.breakdownValue}>{formatSantimAsBirr(entry.totalSantim)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
