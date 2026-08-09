import type { CreatorProfile, CreatorSearchResult, FollowerListItem, FollowStatus } from "@birq/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface FollowedCreatorRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  category: string | null;
  is_live: boolean;
}

// Reuses CreatorSearchResult (search/service.ts) rather than a new shape —
// same "creator card with live status" data either way. Live creators
// first (ORDER BY is_live DESC) so the /following page can render live
// ones up top without re-sorting client-side.
export async function getFollowedCreators(followerId: string): Promise<CreatorSearchResult[]> {
  const { rows } = await pool.query<FollowedCreatorRow>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, cp.category,
            EXISTS (SELECT 1 FROM streams s WHERE s.creator_id = u.id AND s.status = 'live') AS is_live
     FROM follows f
     JOIN users u ON u.id = f.creator_id
     LEFT JOIN creator_profiles cp ON cp.user_id = u.id
     WHERE f.follower_id = $1
     ORDER BY is_live DESC, u.display_name ASC`,
    [followerId]
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    category: row.category,
    isLive: row.is_live,
  }));
}

// Exported — reused by getCreatorProfile below (a second, independent
// caller, not just getFollowStatus's own internal helper anymore).
export async function getFollowerCount(creatorId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT count(*) FROM follows WHERE creator_id = $1`,
    [creatorId]
  );
  return rows[0]?.count ?? 0;
}

interface FollowerRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  followed_at: string;
}

// Creator Dashboard's Community > Followers — the reverse direction of
// getFollowedCreators above (who follows THIS creator, not who they
// follow). Newest first, matching every other "recent activity" list in
// this codebase (chat, gifters, moderation queue).
export async function listMyFollowers(creatorId: string): Promise<FollowerListItem[]> {
  const { rows } = await pool.query<FollowerRow>(
    `SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url, f.created_at AS followed_at
     FROM follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.creator_id = $1
     ORDER BY f.created_at DESC`,
    [creatorId]
  );
  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    followedAt: row.followed_at,
  }));
}

interface CreatorProfileRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
}

// Public creator identity independent of live status — see
// packages/shared/src/schemas/follows.ts's creatorProfileSchema comment
// for why this exists as its own lookup rather than reusing
// getLiveStreamByUsername (that returns null the moment a creator isn't
// currently live, which is exactly when a profile page needs this most).
export async function getCreatorProfile(username: string, viewerId: string | null): Promise<CreatorProfile | null> {
  const { rows } = await pool.query<CreatorProfileRow>(
    `SELECT id, username, display_name, avatar_url, bio, is_verified
     FROM users WHERE username = $1`,
    [username]
  );
  const row = rows[0];
  if (!row) return null;

  const [followerCount, isFollowing] = await Promise.all([
    getFollowerCount(row.id),
    viewerId
      ? pool
          .query(`SELECT 1 FROM follows WHERE follower_id = $1 AND creator_id = $2`, [viewerId, row.id])
          .then((r) => r.rows.length > 0)
      : Promise.resolve(false),
  ]);

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isVerified: row.is_verified,
    followerCount,
    isFollowing,
  };
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
