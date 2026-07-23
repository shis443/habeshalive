import type { FollowStatus } from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

async function getFollowerCount(creatorId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*) FROM follows WHERE creator_id = $1`,
    [creatorId]
  );
  return rows[0]?.count ?? 0;
}

// followerId is null for anonymous viewers — follower count is public,
// "am I following" personalization just defaults to false for them.
export async function getFollowStatus(followerId: string | null, creatorId: string): Promise<FollowStatus> {
  if (!followerId) {
    return { following: false, followerCount: await getFollowerCount(creatorId) };
  }
  const { rows } = await pool.query(
    `SELECT 1 FROM follows WHERE follower_id = $1 AND creator_id = $2`,
    [followerId, creatorId]
  );
  return { following: rows.length > 0, followerCount: await getFollowerCount(creatorId) };
}

export async function toggleFollow(followerId: string, creatorId: string): Promise<FollowStatus> {
  if (followerId === creatorId) throw new AppError(400, "You can't follow yourself");

  const existing = await pool.query(
    `SELECT 1 FROM follows WHERE follower_id = $1 AND creator_id = $2`,
    [followerId, creatorId]
  );

  if (existing.rows.length > 0) {
    await pool.query(`DELETE FROM follows WHERE follower_id = $1 AND creator_id = $2`, [
      followerId,
      creatorId,
    ]);
  } else {
    await pool.query(`INSERT INTO follows (follower_id, creator_id) VALUES ($1, $2)`, [
      followerId,
      creatorId,
    ]);
  }

  return { following: existing.rows.length === 0, followerCount: await getFollowerCount(creatorId) };
}
