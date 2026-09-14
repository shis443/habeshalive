import type { CreatorAnalytics, CreatorAnalyticsWindow } from "@birq/shared";
import { pool } from "../common/db.js";
import { getUserWalletId } from "../common/ledger.js";

const WINDOW_DAYS: Record<CreatorAnalyticsWindow, number> = { "7d": 7, "30d": 30, "90d": 90 };

interface DayRow {
  day: string;
  peak_viewers: number;
  sample_count: string;
  viewer_seconds: string;
  follows_gained: string;
  chat_messages: string;
  revenue_santim: string;
}

// Creator-scoped daily analytics — the admin equivalent
// (admin/analytics-service.ts's getCcuCurve) is platform-wide; this reuses
// its exact "raw stream_viewer_samples UNION ALL rolled-up
// stream_watch_time_daily" pattern (see 0056_stream_viewer_samples.sql),
// scoped to one creator's own streams via a JOIN, plus follows/chat/
// revenue joined onto the same generated day series so every day in the
// window renders (zero-filled), not just days that happen to have data.
// No per-creator rollup table for v1 — this queries the same source
// tables the platform-wide admin view already reads, on demand; a
// materialized rollup is only worth adding if this proves slow at real
// scale (see the ad-engine plan's own note on this same tradeoff).
export async function getCreatorAnalytics(
  creatorId: string,
  window: CreatorAnalyticsWindow
): Promise<CreatorAnalytics> {
  const windowDays = WINDOW_DAYS[window];
  const walletId = await getUserWalletId(pool, creatorId);

  const [dayRows, revenueByTypeRows] = await Promise.all([
    pool.query<DayRow>(
      `WITH day_series AS (
         SELECT generate_series(
           ((now() - ($2 || ' days')::interval) AT TIME ZONE 'Africa/Addis_Ababa')::date,
           (now() AT TIME ZONE 'Africa/Addis_Ababa')::date,
           '1 day'
         )::date AS day
       ), viewer_raw AS (
         SELECT (sv.sampled_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day,
                COUNT(*) AS sample_count,
                MAX(sv.viewer_count) AS peak,
                SUM(sv.viewer_count) * 60 AS viewer_seconds
         FROM stream_viewer_samples sv
         JOIN streams s ON s.id = sv.stream_id
         WHERE s.creator_id = $1 AND sv.sampled_at >= now() - ($2 || ' days')::interval
         GROUP BY day
       ), viewer_rolled AS (
         SELECT d.day, SUM(d.sample_count) AS sample_count,
                MAX(d.peak_viewer_count) AS peak, SUM(d.viewer_seconds) AS viewer_seconds
         FROM stream_watch_time_daily d
         JOIN streams s ON s.id = d.stream_id
         WHERE s.creator_id = $1
           AND d.day >= ((now() - ($2 || ' days')::interval) AT TIME ZONE 'Africa/Addis_Ababa')::date
         GROUP BY d.day
       ), viewer_combined AS (
         SELECT day, SUM(sample_count) AS sample_count, MAX(peak) AS peak, SUM(viewer_seconds) AS viewer_seconds
         FROM (SELECT * FROM viewer_raw UNION ALL SELECT * FROM viewer_rolled) x
         GROUP BY day
       ), follows_by_day AS (
         SELECT (created_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day, COUNT(*) AS count
         FROM follows
         WHERE creator_id = $1 AND created_at >= now() - ($2 || ' days')::interval
         GROUP BY day
       ), chat_by_day AS (
         SELECT (cm.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day, COUNT(*) AS count
         FROM chat_messages cm
         JOIN streams s ON s.id = cm.stream_id
         WHERE s.creator_id = $1 AND cm.is_deleted = FALSE
           AND cm.created_at >= now() - ($2 || ' days')::interval
         GROUP BY day
       ), revenue_by_day AS (
         SELECT (le.created_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day, SUM(le.amount_santim) AS total
         FROM ledger_entries le
         WHERE le.wallet_id = $3 AND le.direction = 'credit'
           AND le.created_at >= now() - ($2 || ' days')::interval
         GROUP BY day
       )
       SELECT ds.day::text AS day,
              COALESCE(vc.peak, 0) AS peak_viewers,
              COALESCE(vc.sample_count, 0) AS sample_count,
              COALESCE(vc.viewer_seconds, 0) AS viewer_seconds,
              COALESCE(f.count, 0) AS follows_gained,
              COALESCE(c.count, 0) AS chat_messages,
              COALESCE(r.total, 0) AS revenue_santim
       FROM day_series ds
       LEFT JOIN viewer_combined vc ON vc.day = ds.day
       LEFT JOIN follows_by_day f ON f.day = ds.day
       LEFT JOIN chat_by_day c ON c.day = ds.day
       LEFT JOIN revenue_by_day r ON r.day = ds.day
       ORDER BY ds.day ASC`,
      [creatorId, windowDays, walletId]
    ),
    pool.query<{ type: string; total: string }>(
      `SELECT lt.type, SUM(le.amount_santim) AS total
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
       WHERE le.wallet_id = $1 AND le.direction = 'credit'
         AND le.created_at >= now() - ($2 || ' days')::interval
       GROUP BY lt.type
       ORDER BY total DESC`,
      [walletId, windowDays]
    ),
  ]);

  const days = dayRows.rows.map((row) => {
    const sampleCount = Number(row.sample_count);
    const viewerSeconds = Number(row.viewer_seconds);
    return {
      day: row.day,
      peakViewers: Number(row.peak_viewers),
      // Average concurrent viewers across the day's actual samples — 0
      // (not NaN) on a day with no samples at all (stream never live).
      avgViewers: sampleCount > 0 ? Math.round((viewerSeconds / 60 / sampleCount) * 100) / 100 : 0,
      watchHours: Math.round((viewerSeconds / 3600) * 100) / 100,
      followsGained: Number(row.follows_gained),
      chatMessages: Number(row.chat_messages),
      revenueSantim: Number(row.revenue_santim),
    };
  });

  const totals = days.reduce(
    (acc, day) => ({
      peakViewers: Math.max(acc.peakViewers, day.peakViewers),
      totalWatchHours: acc.totalWatchHours + day.watchHours,
      followsGained: acc.followsGained + day.followsGained,
      totalRevenueSantim: acc.totalRevenueSantim + day.revenueSantim,
    }),
    { peakViewers: 0, totalWatchHours: 0, followsGained: 0, totalRevenueSantim: 0 }
  );
  totals.totalWatchHours = Math.round(totals.totalWatchHours * 100) / 100;

  return {
    window,
    days,
    revenueByType: revenueByTypeRows.rows.map((row) => ({ type: row.type, totalSantim: Number(row.total) })),
    totals,
  };
}
