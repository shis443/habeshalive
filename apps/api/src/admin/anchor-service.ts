import type { AnchorCandidate, CreatorListItem } from "@habeshalive/shared";
import { pool } from "../common/db.js";

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

// Same row shape/mapping as creators-service.ts's listCreators — kept
// separate rather than imported since the WHERE clause differs (anchor
// status, not search) and duplicating one small query beats threading an
// extra filter param through a function other callers already depend on.
function mapCreatorRow(row: CreatorRow): CreatorListItem {
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

export async function listAnchorCreators(): Promise<CreatorListItem[]> {
  const { rows } = await pool.query<CreatorRow>(
    `SELECT u.id, u.username, u.display_name, cp.revenue_share_bps, cp.is_anchor_creator, u.is_suspended,
            (SELECT sum(amount_santim) FROM payouts WHERE creator_id = u.id AND status = 'paid') AS total_payouts_santim,
            (SELECT count(*) FROM streams WHERE creator_id = u.id) AS stream_count,
            (SELECT count(*) FROM follows WHERE creator_id = u.id) AS follower_count
     FROM users u
     JOIN creator_profiles cp ON cp.user_id = u.id
     WHERE cp.is_anchor_creator = TRUE
     ORDER BY total_payouts_santim DESC NULLS LAST`
  );
  return rows.map(mapCreatorRow);
}

// No application/pipeline subsystem exists for Anchor Creator Program (see
// packages/shared/src/schemas/admin.ts's anchorCandidateSchema comment) —
// this ranks existing creators by real revenue generated (gifts + boosts +
// subscriptions credited to their wallet) so an admin has something
// concrete to act on instead of guessing who to reach out to. The
// isAnchorCreator toggle on the Creators page is still what actually
// promotes someone.
export async function listAnchorCandidates(limit = 25): Promise<AnchorCandidate[]> {
  const { rows } = await pool.query<{
    id: string;
    username: string;
    display_name: string;
    lifetime_earnings_santim: string | null;
    stream_count: string;
    follower_count: string;
    created_at: string;
  }>(
    `SELECT u.id, u.username, u.display_name, u.created_at,
            (SELECT count(*) FROM streams WHERE creator_id = u.id) AS stream_count,
            (SELECT count(*) FROM follows WHERE creator_id = u.id) AS follower_count,
            (SELECT sum(le.amount_santim)
             FROM ledger_entries le
             JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
             JOIN wallets w ON w.id = le.wallet_id
             WHERE w.owner_id = u.id AND le.direction = 'credit' AND lt.type IN ('gift', 'boost', 'subscription')
            ) AS lifetime_earnings_santim
     FROM users u
     JOIN creator_profiles cp ON cp.user_id = u.id
     WHERE u.role = 'creator' AND cp.is_anchor_creator = FALSE
     ORDER BY lifetime_earnings_santim DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return rows
    .filter((row) => Number(row.lifetime_earnings_santim ?? 0) > 0)
    .map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      lifetimeEarningsSantim: Number(row.lifetime_earnings_santim ?? 0),
      streamCount: Number(row.stream_count),
      followerCount: Number(row.follower_count),
      accountCreatedAt: row.created_at,
    }));
}
