import type { ActiveBoost, AdminAuditAction, AdminSummary } from "@habeshalive/shared";
import { pool } from "../common/db.js";

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
    pool.query<{ total: string | null }>(
      `SELECT sum(gt.price_santim * gs.quantity)::text AS total FROM gifts_sent gs
       JOIN gift_types gt ON gt.id = gs.gift_type_id`
    ),
    pool.query<{ count: string; mrr: string | null }>(
      `SELECT count(*)::text AS count, sum(t.price_santim)::text AS mrr
       FROM subscriptions s JOIN subscription_tiers t ON t.id = s.tier_id
       WHERE s.status = 'active'`
    ),
    pool.query<{ total: string | null }>(`SELECT sum(price_santim)::text AS total FROM stream_boosts`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users WHERE created_at >= current_date`),
    pool.query<{ total: string | null }>(
      `SELECT sum(gt.price_santim * gs.quantity)::text AS total FROM gifts_sent gs
       JOIN gift_types gt ON gt.id = gs.gift_type_id
       WHERE gs.created_at >= current_date`
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
export async function listAdminActions(limit = 100): Promise<AdminAuditAction[]> {
  const { rows } = await pool.query<{
    id: string;
    actor_username: string;
    action: string;
    target_type: string;
    target_id: string | null;
    reason: string | null;
    created_at: string;
  }>(
    `SELECT aa.id, u.username AS actor_username, aa.action, aa.target_type, aa.target_id, aa.reason, aa.created_at
     FROM admin_actions aa
     JOIN users u ON u.id = aa.actor_id
     ORDER BY aa.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    actorUsername: row.actor_username,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
