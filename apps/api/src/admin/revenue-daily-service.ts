import { pool } from "../common/db.js";

// Recompute the trailing 35 days nightly, not just yesterday — refunds
// and chargebacks arrive late and must be able to move a historical
// figure. 35 is a deliberate margin over a typical dispute window.
const RECOMPUTE_TRAILING_DAYS = 35;

// Every viewer-funded-or-ad-funded credit type a creator can earn from —
// same set T5's top_streamers_revenue board uses, for the same reason
// (boost is the creator paying the platform, an expense not revenue;
// refund reverses money already counted once under its original type).
const REVENUE_TRANSACTION_TYPES = ["gift", "donation", "ppv_purchase", "subscription", "ad"];

// Recomputes and upserts exactly one Africa/Addis_Ababa calendar day's
// row. All in one round trip: every column is a scalar aggregate over a
// [start, end) window, so cross-joining single-row CTEs together is safe
// (no fan-out) and avoids five separate queries per day for what's
// already a 35-day loop every night.
//
// refunds_santim and chargebacks_santim are NOT computed from the ledger
// here — they're always 0. This codebase has no distinct, identifiable
// "a customer's top-up was refunded" or "a payment was charged back"
// concept yet. ledger_transactions.type = 'refund' already means
// something else entirely (reversing a FAILED PAYOUT, crediting the
// creator back) — querying it here would be actively wrong, not just
// incomplete, since counting a payout reversal as customer-facing
// revenue lost has nothing to do with what it actually is. See this
// migration's own comment (0059_revenue_daily.sql) for the same note.
export async function recomputeRevenueDailyForDay(day: string): Promise<void> {
  await pool.query(
    `WITH bounds AS (
       SELECT
         ($1::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AS start_ts,
         (($1::date + 1)::timestamp AT TIME ZONE 'Africa/Addis_Ababa') AS end_ts
     ),
     gross AS (
       SELECT COALESCE(SUM(le.amount_santim), 0) AS v
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
       JOIN wallets w ON w.id = le.wallet_id, bounds
       WHERE lt.type = 'topup' AND lt.status = 'completed' AND le.direction = 'credit'
         AND w.owner_type = 'user'
         AND lt.completed_at >= bounds.start_ts AND lt.completed_at < bounds.end_ts
     ),
     creator_share AS (
       SELECT COALESCE(SUM(le.amount_santim), 0) AS v
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
       JOIN wallets w ON w.id = le.wallet_id, bounds
       WHERE lt.type = ANY($2) AND lt.status = 'completed' AND le.direction = 'credit'
         AND w.owner_type = 'user'
         AND lt.completed_at >= bounds.start_ts AND lt.completed_at < bounds.end_ts
     ),
     promo AS (
       SELECT COALESCE(SUM(le.amount_santim), 0) AS v
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id, bounds
       WHERE le.funding_bucket = 'promotional' AND le.direction = 'credit' AND lt.status = 'completed'
         AND lt.completed_at >= bounds.start_ts AND lt.completed_at < bounds.end_ts
     ),
     paying AS (
       SELECT COUNT(DISTINCT w.owner_id) AS v
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
       JOIN wallets w ON w.id = le.wallet_id, bounds
       WHERE lt.type = 'topup' AND lt.status = 'completed' AND le.direction = 'credit'
         AND w.owner_type = 'user'
         AND lt.completed_at >= bounds.start_ts AND lt.completed_at < bounds.end_ts
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
     INSERT INTO revenue_daily
       (day, gross_santim, refunds_santim, chargebacks_santim, creator_share_santim,
        promo_issued_santim, paying_users, active_users, active_streamers, computed_at)
     SELECT $1::date, gross.v, 0, 0, creator_share.v, promo.v, paying.v, active.v, streamers.v, now()
     FROM gross, creator_share, promo, paying, active, streamers
     ON CONFLICT (day) DO UPDATE SET
       gross_santim = EXCLUDED.gross_santim,
       refunds_santim = EXCLUDED.refunds_santim,
       chargebacks_santim = EXCLUDED.chargebacks_santim,
       creator_share_santim = EXCLUDED.creator_share_santim,
       promo_issued_santim = EXCLUDED.promo_issued_santim,
       paying_users = EXCLUDED.paying_users,
       active_users = EXCLUDED.active_users,
       active_streamers = EXCLUDED.active_streamers,
       computed_at = EXCLUDED.computed_at`,
    [day, REVENUE_TRANSACTION_TYPES]
  );
}

// The periodic job (server.ts). One round trip to get the trailing N
// Addis calendar days (today included), computed by Postgres itself —
// see leaderboard-service.ts's top-of-file comment for why every date
// boundary in this codebase is a plain string, never a JS Date
// (node-postgres's DATE parser uses the process's local timezone
// offset, not UTC).
export async function recomputeTrailingRevenueDays(days = RECOMPUTE_TRAILING_DAYS): Promise<void> {
  const { rows } = await pool.query<{ day: string }>(
    `SELECT ((now() AT TIME ZONE 'Africa/Addis_Ababa')::date - g)::text AS day
     FROM generate_series(0, $1 - 1) AS g`,
    [days]
  );
  for (const { day } of rows) {
    await recomputeRevenueDailyForDay(day);
  }
}

export interface RevenueDailyPoint {
  day: string;
  grossSantim: number;
  netSantim: number;
  activeUsers: number;
  payingUsers: number;
  activeStreamers: number;
  arpuSantim: number;
  arppuSantim: number;
  conversionPct: number;
}

// Reads v_revenue_kpis — never revenue_daily directly for anything ratio-
// shaped, so no caller can define ARPU/conversion differently than any
// other caller.
export async function getRevenueKpiRange(startDay: string, endDay: string): Promise<RevenueDailyPoint[]> {
  const { rows } = await pool.query<{
    day: string;
    gross_santim: string;
    net_santim: string;
    active_users: number;
    paying_users: number;
    active_streamers: number;
    arpu_santim: string;
    arppu_santim: string;
    conversion_pct: string;
  }>(
    `SELECT day::text, gross_santim::text, net_santim::text, active_users, paying_users, active_streamers,
            arpu_santim::text, arppu_santim::text, conversion_pct::text
     FROM v_revenue_kpis
     WHERE day >= $1::date AND day < $2::date
     ORDER BY day ASC`,
    [startDay, endDay]
  );
  return rows.map((r) => ({
    day: r.day,
    grossSantim: Number(r.gross_santim),
    netSantim: Number(r.net_santim),
    activeUsers: r.active_users,
    payingUsers: r.paying_users,
    activeStreamers: r.active_streamers,
    arpuSantim: Number(r.arpu_santim),
    arppuSantim: Number(r.arppu_santim),
    conversionPct: Number(r.conversion_pct),
  }));
}
