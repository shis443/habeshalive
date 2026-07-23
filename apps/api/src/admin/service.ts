import type { AdminSummary } from "@habeshalive/shared";
import { pool } from "../common/db.js";

// Six real counts, one query each — no caching layer, this endpoint is for
// a human glancing at an admin dashboard, not a hot path.
export async function getAdminSummary(): Promise<AdminSummary> {
  const [payouts, flags, reports, appeals, streams, users] = await Promise.all([
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM payouts WHERE status = 'pending_review'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM moderation_flags WHERE status = 'pending'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM reports WHERE status = 'pending'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM appeals WHERE status = 'pending'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM streams WHERE status = 'live'`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users`),
  ]);

  return {
    pendingPayouts: Number(payouts.rows[0]?.count ?? 0),
    pendingModerationFlags: Number(flags.rows[0]?.count ?? 0),
    pendingReports: Number(reports.rows[0]?.count ?? 0),
    pendingAppeals: Number(appeals.rows[0]?.count ?? 0),
    liveStreams: Number(streams.rows[0]?.count ?? 0),
    totalUsers: Number(users.rows[0]?.count ?? 0),
  };
}
