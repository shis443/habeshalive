import type { ActiveBoost, AdminAuditAction, AdminSummary } from "@birq/shared";
import { pool } from "../common/db.js";
import { ALLTIME_WINDOW_START } from "./leaderboard-service.js";

// Eleven real counts, one query each — no caching layer, this endpoint is
// for a human glancing at an admin dashboard, not a hot path.
export async function getAdminSummary(): Promise<AdminSummary> {
  const [
    payouts,
    flags,
    reports,
    appeals,
    streams,
    users,
    creators,
    giftVolume,
    subs,
    boostRevenue,
    todaySignups,
    todayGiftVolume,
  ] = await Promise.all([
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM payouts WHERE status = 'pending_review'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM moderation_flags WHERE status = 'pending'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM reports WHERE status = 'pending'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM appeals WHERE status = 'pending'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM streams WHERE status = 'live'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users WHERE role = 'creator'`),
    // T6: sourced from T5's leaderboard rollup (SUM across every gifter's
    // own alltime total), not a live SUM over every gifts_sent row ever
    // written — that scan only gets slower as the platform grows, this
    // read stays a small, indexed lookup on idx_leaderboard_read
    // regardless of ledger size. Falls back to 0, not a scan, before the
    // rebuild job has ever run (e.g. right after a fresh migration).
    pool.query<{ total: string | null }>(
      `SELECT sum(value)::text AS total FROM leaderboard_snapshots
       WHERE board = 'top_gifters' AND window_kind = 'alltime' AND window_start = $1::date`,
      [ALLTIME_WINDOW_START]
    ),
    pool.query<{ count: string; mrr: string | null }>(
      `SELECT count(*)::text AS count, sum(t.price_santim)::text AS mrr
       FROM subscriptions s JOIN subscription_tiers t ON t.id = s.tier_id
       WHERE s.status = 'active'`
    ),
    pool.query<{ total: string | null }>(`SELECT sum(price_santim)::text AS total FROM stream_boosts`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users WHERE created_at >= current_date`),
    // Same rollup source, today's daily slot instead of alltime.
    pool.query<{ total: string | null }>(
      `SELECT sum(value)::text AS total FROM leaderboard_snapshots
       WHERE board = 'top_gifters' AND window_kind = 'daily'
         AND window_start = (now() AT TIME ZONE 'Africa/Addis_Ababa')::date`
    ),
  ]);

  return {
    pendingPayouts: Number(payouts.rows[0]?.count ?? 0),
    pendingModerationFlags: Number(flags.rows[0]?.count ?? 0),
    pendingReports: Number(reports.rows[0]?.count ?? 0),
    pendingAppeals: Number(appeals.rows[0]?.count ?? 0),
    liveStreams: Number(streams.rows[0]?.count ?? 0),
    totalUsers: Number(users.rows[0]?.count ?? 0),
    totalCreators: Number(creators.rows[0]?.count ?? 0),
    giftVolumeSantim: Number(giftVolume.rows[0]?.total ?? 0),
    activeSubscriptions: Number(subs.rows[0]?.count ?? 0),
    mrrSantim: Number(subs.rows[0]?.mrr ?? 0),
    boostRevenueSantim: Number(boostRevenue.rows[0]?.total ?? 0),
    todaySignups: Number(todaySignups.rows[0]?.count ?? 0),
    todayGiftVolumeSantim: Number(todayGiftVolume.rows[0]?.total ?? 0),
  };
}

// Currently-live boosts only — a purchased-but-expired boost has nothing
// left for an admin to act on, so the list doesn't carry history.
export async function listActiveBoosts(): Promise<ActiveBoost[]> {
  const { rows } = await pool.query<{
    id: string;
    creator_id: string;
    username: string;
    price_santim: number;
    starts_at: string;
    ends_at: string;
  }>(
    `SELECT b.id, b.creator_id, u.username, b.price_santim, b.starts_at, b.ends_at
     FROM stream_boosts b
     JOIN users u ON u.id = b.creator_id
     WHERE b.ends_at > now()
     ORDER BY b.ends_at ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    creatorId: row.creator_id,
    creatorUsername: row.username,
    priceSantim: row.price_santim,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }));
}

// The unified cross-cutting audit trail — see admin/audit.ts's
// logAdminAction, called from every admin mutation across the codebase.
// `action` filters by prefix (actions follow a "domain.verb" convention,
// e.g. "subscription.%", "creator.%") since there's no dedicated
// domain/category column to filter on instead.
export async function listAdminActions(
  filters: { limit?: number; action?: string; session?: string } = {}
): Promise<AdminAuditAction[]> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const { rows } = await pool.query<{
    id: string;
    actor_username: string;
    action: string;
    target_type: string;
    target_id: string | null;
    reason: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    actor_ip: string | null;
    actor_session: string | null;
    before_state: unknown;
    after_state: unknown;
  }>(
    `SELECT aa.id, u.username AS actor_username, aa.action, aa.target_type, aa.target_id, aa.reason, aa.metadata,
            aa.created_at,
            -- host(), not ::text: casting INET to text keeps the netmask
            -- ('198.51.100.7/32' for a single address) — confirmed with a
            -- real query before writing this, after the first version of
            -- this SELECT shipped that /32 straight into the admin UI.
            -- host() is the function that returns just the address.
            host(aa.actor_ip) AS actor_ip,
            aa.actor_session, aa.before_state, aa.after_state
     FROM admin_actions aa
     JOIN users u ON u.id = aa.actor_id
     WHERE ($2::text IS NULL OR aa.action LIKE $2 || '%')
       AND ($3::uuid IS NULL OR aa.actor_session = $3::uuid)
     ORDER BY aa.created_at DESC
     LIMIT $1`,
    [limit, filters.action ?? null, filters.session ?? null]
  );
  return rows.map((row) => ({
    id: row.id,
    actorUsername: row.actor_username,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.created_at,
    actorIp: row.actor_ip,
    actorSessionId: row.actor_session,
    beforeState: row.before_state,
    afterState: row.after_state,
  }));
}
