import type { FollowStatus } from "@birq/shared";
import { pool } from "../common/db.js";

// Phase 3.4 — category following (category_follows, migration 0042).
// Mirrors service.ts's toggleFollow/getFollowStatus shape exactly (same
// FollowStatus return type — {following, followerCount} needs nothing
// category-specific) since it's the same underlying pattern: no self-
// follow concern here (a category isn't a user), so this is actually
// simpler than the creator version.

export async function getCategoryFollowerCount(category: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*) FROM category_follows WHERE category = $1`,
    [category]
  );
  return rows[0]?.count ?? 0;
}

// followerId null for anonymous viewers — same convention as
// getFollowStatus's own null-followerId branch.
export async function getCategoryFollowStatus(followerId: string | null, category: string): Promise<FollowStatus> {
  if (!followerId) {
    return { following: false, followerCount: await getCategoryFollowerCount(category) };
  }
  const { rows } = await pool.query(`SELECT 1 FROM category_follows WHERE user_id = $1 AND category = $2`, [
    followerId,
    category,
  ]);
  return { following: rows.length > 0, followerCount: await getCategoryFollowerCount(category) };
}

export async function toggleCategoryFollow(followerId: string, category: string): Promise<FollowStatus> {
  const existing = await pool.query(`SELECT 1 FROM category_follows WHERE user_id = $1 AND category = $2`, [
    followerId,
    category,
  ]);

  if (existing.rows.length > 0) {
    await pool.query(`DELETE FROM category_follows WHERE user_id = $1 AND category = $2`, [followerId, category]);
  } else {
    await pool.query(`INSERT INTO category_follows (user_id, category) VALUES ($1, $2)`, [followerId, category]);
  }

  return { following: existing.rows.length === 0, followerCount: await getCategoryFollowerCount(category) };
}
