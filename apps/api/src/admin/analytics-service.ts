import { pool } from "../common/db.js";
import {
  ALLTIME_WINDOW_START,
  getLeaderboard,
  getOpenWindowBoundaries,
  type LeaderboardBoard,
  type LeaderboardEntry,
  type LeaderboardWindowKind,
} from "./leaderboard-service.js";
import { getRevenueKpiRange, type RevenueDailyPoint } from "./revenue-daily-service.js";

const REVENUE_TRANSACTION_TYPES = ["gift", "donation", "ppv_purchase", "subscription", "ad"];

export interface PeriodSummary {
  grossSantim: number;
  netSantim: number;
  creatorShareSantim: number;
  activeUsers: number;
  payingUsers: number;
  activeStreamers: number;
  arpuSantim: number;
  arppuSantim: number;
  conversionPct: number;
}

// A period total, not a sum of daily rollup rows — activeUsers/
// payingUsers/activeStreamers are genuine DISTINCT counts over the whole
// [start, end) range, which summing revenue_daily's per-day counts could
// never give (a user active on three different days would be counted
// three times). Money figures (gross/net/creatorShare) ARE simple sums,
// since a santim credited on Tuesday and one credited on Wednesday are
// both really there — money doesn't de-duplicate the way people do.
export async function getPeriodSummary(startDay: string, endDay: string): Promise<PeriodSummary> {
  const { rows } = await pool.query<{
    gross: string;
    creator_share: string;
    active_users: string;
    paying_users: string;
    active_streamers: string;
  }>(
    `WITH bounds AS (
       SELECT ($1::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AS start_ts,
              ($2::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AS end_ts
     ),
     gross AS (
       SELECT COALESCE(SUM(le.amount_santim), 0) AS v
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
       JOIN wallets w ON w.id = le.wallet_id, bounds
       WHERE lt.type = 'topup' AND lt.status = 'completed' AND le.direction = 'credit'
         AND w.owner_type = 'user' AND lt.completed_at >= bounds.start_ts AND lt.completed_at < bounds.end_ts
     ),
     creator_share AS (
       SELECT COALESCE(SUM(le.amount_santim), 0) AS v
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
       JOIN wallets w ON w.id = le.wallet_id, bounds
       WHERE lt.type = ANY($3) AND lt.status = 'completed' AND le.direction = 'credit'
         AND w.owner_type = 'user' AND lt.completed_at >= bounds.start_ts AND lt.completed_at < bounds.end_ts
     ),
     paying AS (
       SELECT COUNT(DISTINCT w.owner_id) AS v
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
       JOIN wallets w ON w.id = le.wallet_id, bounds
       WHERE lt.type = 'topup' AND lt.status = 'completed' AND le.direction = 'credit'
         AND w.owner_type = 'user' AND lt.completed_at >= bounds.start_ts AND lt.completed_at < bounds.end_ts
     ),
     active AS (
       SELECT COUNT(DISTINCT user_id) AS v FROM sessions, bounds
       WHERE last_seen_at >= bounds.start_ts AND last_seen_at < bounds.end_ts
     ),
     streamers AS (
       SELECT COUNT(DISTINCT s.creator_id) AS v
       FROM stream_events se JOIN streams s ON s.id = se.stream_id, bounds
       WHERE se.type = 'started' AND se.created_at >= bounds.start_ts AND se.created_at < bounds.end_ts
     )
     SELECT gross.v::text AS gross, creator_share.v::text AS creator_share,
            active.v::text AS active_users, paying.v::text AS paying_users, streamers.v::text AS active_streamers
     FROM gross, creator_share, active, paying, streamers`,
    [startDay, endDay, REVENUE_TRANSACTION_TYPES]
  );
  const r = rows[0]!;
  const grossSantim = Number(r.gross);
  const creatorShareSantim = Number(r.creator_share);
  const activeUsers = Number(r.active_users);
  const payingUsers = Number(r.paying_users);
  // refunds/chargebacks are always 0 (see revenue-daily-service.ts) —
  // net at the period level uses the same formula as the generated
  // column, just over the wider range, so this can never disagree with
  // any single day's own net_santim.
  const netSantim = grossSantim - creatorShareSantim;
  return {
    grossSantim,
    netSantim,
    creatorShareSantim,
    activeUsers,
    payingUsers,
    activeStreamers: Number(r.active_streamers),
    arpuSantim: activeUsers === 0 ? 0 : Math.round((grossSantim / activeUsers) * 100) / 100,
    arppuSantim: payingUsers === 0 ? 0 : Math.round((grossSantim / payingUsers) * 100) / 100,
    conversionPct: activeUsers === 0 ? 0 : Math.round((10000 * payingUsers) / activeUsers) / 100,
  };
}

export interface CcuCurvePoint {
  day: string;
  peakViewers: number;
}

// Platform-wide daily peak — the highest simultaneous-viewers moment
// across every stream, per day. Same raw-plus-rolled-up UNION ALL
// pattern as T5's top_streamers_ccu, just not grouped by creator.
export async function getCcuCurve(startDay: string, endDay: string): Promise<CcuCurvePoint[]> {
  const { rows } = await pool.query<{ day: string; peak: number }>(
    `WITH raw AS (
       SELECT (sampled_at AT TIME ZONE 'Africa/Addis_Ababa')::date AS day, MAX(viewer_count) AS peak
       FROM stream_viewer_samples
       WHERE (sampled_at AT TIME ZONE 'Africa/Addis_Ababa')::date >= $1::date
         AND (sampled_at AT TIME ZONE 'Africa/Addis_Ababa')::date < $2::date
       GROUP BY day
     ), rolled AS (
       SELECT day, MAX(peak_viewer_count) AS peak
       FROM stream_watch_time_daily
       WHERE day >= $1::date AND day < $2::date
       GROUP BY day
     )
     SELECT day::text, MAX(peak) AS peak
     FROM (SELECT * FROM raw UNION ALL SELECT * FROM rolled) combined
     GROUP BY day
     ORDER BY day ASC`,
    [startDay, endDay]
  );
  return rows.map((r) => ({ day: r.day, peakViewers: r.peak }));
}

export interface AnalyticsOverview {
  current: PeriodSummary;
  previous: PeriodSummary;
  dailySeries: RevenueDailyPoint[];
  ccuCurve: CcuCurvePoint[];
}

// periodDays=30: "current" is the trailing 30 days including today,
// "previous" is the 30 days before that — the period-over-period deltas
// the task asks for. dailySeries/ccuCurve cover the current period only
// (the chart's own x-axis).
export async function getAnalyticsOverview(periodDays = 30): Promise<AnalyticsOverview> {
  const { rows } = await pool.query<{ current_start: string; current_end: string; previous_start: string }>(
    `SELECT
       ((now() AT TIME ZONE 'Africa/Addis_Ababa')::date - ($1 - 1))::text AS current_start,
       ((now() AT TIME ZONE 'Africa/Addis_Ababa')::date + 1)::text AS current_end,
       ((now() AT TIME ZONE 'Africa/Addis_Ababa')::date - ($1 - 1) - $1)::text AS previous_start`,
    [periodDays]
  );
  const { current_start, current_end, previous_start } = rows[0]!;

  const [current, previous, dailySeries, ccuCurve] = await Promise.all([
    getPeriodSummary(current_start, current_end),
    getPeriodSummary(previous_start, current_start),
    getRevenueKpiRange(current_start, current_end),
    getCcuCurve(current_start, current_end),
  ]);

  return { current, previous, dailySeries, ccuCurve };
}

export interface LeaderboardRow extends LeaderboardEntry {
  username: string;
  displayName: string;
}

// The window-switcher read path — enriches T5's bare (subjectId, rank,
// value) rows with the display info an admin UI actually needs, without
// changing what leaderboard-service.ts itself returns (that stays
// display-agnostic, since T5 has no UI of its own).
export async function getLeaderboardForDisplay(
  board: LeaderboardBoard,
  windowKind: LeaderboardWindowKind,
  windowStart: string
): Promise<LeaderboardRow[]> {
  const entries = await getLeaderboard(board, windowKind, windowStart);
  if (entries.length === 0) return [];
  const { rows } = await pool.query<{ id: string; username: string; display_name: string }>(
    `SELECT id, username, display_name FROM users WHERE id = ANY($1)`,
    [entries.map((e) => e.subjectId)]
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return entries.map((e) => ({
    ...e,
    username: byId.get(e.subjectId)?.username ?? "unknown",
    displayName: byId.get(e.subjectId)?.display_name ?? "Unknown",
  }));
}

export interface WindowOption {
  windowKind: LeaderboardWindowKind;
  windowStart: string;
  label: string;
}

// The leaderboard window switcher's actual choices — exactly the slots
// T5's rebuildOpenLeaderboardWindows keeps populated (today/yesterday,
// this/last week, this/last month, alltime), not a free-form date picker
// that would mostly return empty results for any date outside that set.
export async function getAvailableWindowOptions(): Promise<WindowOption[]> {
  const b = await getOpenWindowBoundaries();
  return [
    { windowKind: "daily", windowStart: b.today, label: "Today" },
    { windowKind: "daily", windowStart: b.yesterday, label: "Yesterday" },
    { windowKind: "weekly", windowStart: b.this_week_start, label: "This week" },
    { windowKind: "weekly", windowStart: b.last_week_start, label: "Last week" },
    { windowKind: "monthly", windowStart: b.this_month_start, label: "This month" },
    { windowKind: "monthly", windowStart: b.last_month_start, label: "Last month" },
    { windowKind: "alltime", windowStart: ALLTIME_WINDOW_START, label: "All time" },
  ];
}
