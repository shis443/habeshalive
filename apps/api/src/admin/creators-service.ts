import type { CreatorListItem, SuspendCreatorInput, UpdateCreatorInput } from "@habeshalive/shared";
import { logAdminAction } from "./audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface CreatorRow {
  id: string;
  username: string;
  display_name: string;
  revenue_share_bps: number;
  is_anchor_creator: boolean;
  is_suspended: boolean;
  total_payouts_santim: string | null;
  stream_count: string;
  follower_count: string;
}

function mapRow(row: CreatorRow): CreatorListItem {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    revenueShareBps: row.revenue_share_bps,
    isAnchorCreator: row.is_anchor_creator,
    isSuspended: row.is_suspended,
    totalPayoutsSantim: Number(row.total_payouts_santim ?? 0),
    streamCount: Number(row.stream_count),
    followerCount: Number(row.follower_count),
  };
}

export async function listCreators(search?: string): Promise<CreatorListItem[]> {
  const { rows } = await pool.query<CreatorRow>(
    `SELECT u.id, u.username, u.display_name, cp.revenue_share_bps, cp.is_anchor_creator, u.is_suspended,
            (SELECT sum(amount_santim) FROM payouts WHERE creator_id = u.id AND status = 'paid') AS total_payouts_santim,
            (SELECT count(*) FROM streams WHERE creator_id = u.id) AS stream_count,
            (SELECT count(*) FROM follows WHERE creator_id = u.id) AS follower_count
     FROM users u
     JOIN creator_profiles cp ON cp.user_id = u.id
     WHERE u.role = 'creator'
       AND ($1::text IS NULL OR u.username ILIKE '%' || $1 || '%')
     ORDER BY total_payouts_santim DESC NULLS LAST
     LIMIT 100`,
    [search ?? null]
  );
  return rows.map(mapRow);
}

export async function updateCreator(
  adminId: string,
  creatorId: string,
  input: UpdateCreatorInput
): Promise<CreatorListItem> {
  const { rows: existing } = await pool.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [
    creatorId,
  ]);
  if (!existing[0]) throw new AppError(404, "Creator not found");

  await pool.query(
    `UPDATE creator_profiles SET
       revenue_share_bps = COALESCE($1, revenue_share_bps),
       is_anchor_creator = COALESCE($2, is_anchor_creator),
       updated_at = now()
     WHERE user_id = $3`,
    [input.revenueShareBps ?? null, input.isAnchorCreator ?? null, creatorId]
  );

  await logAdminAction(adminId, "creator.update", "creator", creatorId, { metadata: input });

  const { rows } = await pool.query<CreatorRow>(
    `SELECT u.id, u.username, u.display_name, cp.revenue_share_bps, cp.is_anchor_creator, u.is_suspended,
            (SELECT sum(amount_santim) FROM payouts WHERE creator_id = u.id AND status = 'paid') AS total_payouts_santim,
            (SELECT count(*) FROM streams WHERE creator_id = u.id) AS stream_count,
            (SELECT count(*) FROM follows WHERE creator_id = u.id) AS follower_count
     FROM users u JOIN creator_profiles cp ON cp.user_id = u.id WHERE u.id = $1`,
    [creatorId]
  );
  return mapRow(rows[0]!);
}

// Distinct from a moderation ban: revokes streaming and payout privileges
// specifically (enforced in streams/service.ts's goLive and
// wallet/service.ts's requestPayout), not chat/gifting/viewing — a
// creator-specific business action, not a trust & safety one.
export async function suspendCreator(adminId: string, creatorId: string, input: SuspendCreatorInput): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE users SET is_suspended = TRUE, suspended_reason = $1, updated_at = now() WHERE id = $2 AND role = 'creator'`,
    [input.reason, creatorId]
  );
  if (!rowCount) throw new AppError(404, "Creator not found");
  await logAdminAction(adminId, "creator.suspend", "creator", creatorId, { reason: input.reason });
}

export async function unsuspendCreator(adminId: string, creatorId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE users SET is_suspended = FALSE, suspended_reason = NULL, updated_at = now() WHERE id = $1 AND role = 'creator'`,
    [creatorId]
  );
  if (!rowCount) throw new AppError(404, "Creator not found");
  await logAdminAction(adminId, "creator.unsuspend", "creator", creatorId);
}
