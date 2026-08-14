import type { FollowedCreator, CreatorProfile, FollowerListItem, FollowStatus } from "@birq/shared";
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
  new_content_count: number;
  stream_id?: string | null;
  stream_title?: string | null;
  stream_category?: string | null;
  stream_language?: string | null;
  stream_thumbnail_url?: string | null;
  stream_playback_url?: string | null;
  stream_started_at?: string | null;
  stream_aspect_ratio?: string | null;
  stream_peak_viewers?: number | null;
  stream_is_boosted?: boolean | null;
  stream_is_sensitive?: boolean | null;
  stream_is_ppv?: boolean | null;
  stream_ppv_price_santim?: number | null;
  stream_tags?: string[] | null;
}

// Phase B — real unseen-content count, not a boolean. NULL
// following_last_seen_at is treated as "-infinity" so a fresh follower sees
// every followed creator's existing content as new until the viewer marks the
// page as seen. Live creators first so the /following page can render live ones
// up top without re-sorting client-side.
export async function getFollowedCreators(followerId: string): Promise<FollowedCreator[]> {
  const { rows: userRows } = await pool.query<{ following_last_seen_at: string | null }>(
    `SELECT following_last_seen_at FROM users WHERE id = $1`,
    [followerId]
  );
  const lastSeenAt = userRows[0]?.following_last_seen_at ?? null;

  const { rows } = await pool.query<FollowedCreatorRow>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, cp.category,
            s.id AS stream_id,
            s.title AS stream_title,
            s.category AS stream_category,
            s.language AS stream_language,
            s.thumbnail_url AS stream_thumbnail_url,
            s.playback_url AS stream_playback_url,
            s.started_at AS stream_started_at,
            s.aspect_ratio AS stream_aspect_ratio,
            s.peak_viewers AS stream_peak_viewers,
            (EXISTS (SELECT 1 FROM stream_boosts b WHERE b.creator_id = s.creator_id AND b.ends_at > now())) AS stream_is_boosted,
            s.is_sensitive AS stream_is_sensitive,
            s.is_ppv AS stream_is_ppv,
            s.ppv_price_santim AS stream_ppv_price_santim,
            COALESCE((SELECT array_agg(st.name ORDER BY st.name)
                      FROM stream_tag_links stl JOIN stream_tags st ON st.id = stl.tag_id WHERE stl.stream_id = s.id), ARRAY[]::text[]) AS stream_tags,
            (
              SELECT COALESCE(COUNT(*), 0)
              FROM (
                SELECT v.id
                FROM stream_vods v
                JOIN streams s2 ON s2.id = v.stream_id
                WHERE s2.creator_id = u.id AND v.is_published = true AND v.dmca_removed_at IS NULL
                  AND v.created_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)
                UNION ALL
                SELECT c.id
                FROM clips c
                WHERE c.creator_id = u.id AND c.dmca_removed_at IS NULL
                  AND c.created_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)
              ) new_content
            ) AS new_content_count
     FROM follows f
     JOIN users u ON u.id = f.creator_id
     LEFT JOIN streams s ON s.creator_id = u.id AND s.status = 'live'
     LEFT JOIN creator_profiles cp ON cp.user_id = u.id
     WHERE f.follower_id = $1
     ORDER BY (s.id IS NOT NULL) DESC, u.display_name ASC`,
    [followerId, lastSeenAt]
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    category: row.category,
    isLive: !!row.stream_id,
    newContentCount: row.new_content_count,
    currentStream: row.stream_id
      ? {
          status: "live",
          id: row.stream_id,
          title: row.stream_title ?? "",
          category: row.stream_category ?? null,
          language: row.stream_language ?? null,
          thumbnailUrl: row.stream_thumbnail_url ?? null,
          playbackUrl: null,
          startedAt: row.stream_started_at ?? null,
          aspectRatio: (row.stream_aspect_ratio as any) ?? "16:9",
          viewerCount: row.stream_peak_viewers ?? 0,
          isBoosted: !!row.stream_is_boosted,
          isSensitive: !!row.stream_is_sensitive,
          tags: row.stream_tags ?? [],
          isPpv: !!row.stream_is_ppv,
          ppvPriceSantim: row.stream_ppv_price_santim ?? null,
          hasPpvAccess: !row.stream_is_ppv,
          creator: {
            id: row.id,
            username: row.username,
            displayName: row.display_name,
            avatarUrl: row.avatar_url,
            bio: row.bio,
            isVerified: false,
          },
        }
      : null,
  }));
}

// Separate, explicit action rather than a side effect of
// getFollowedCreators above (called from a "the user is genuinely
// looking at this page now" client beacon, not the GET itself) — same
// reasoning as notifications/service.ts's markRead/markAllRead staying
// distinct from listNotifications: a GET can be triggered by prefetch/
// revalidation without real user intent, and marking everything seen on
// that would hide badges the viewer never actually saw.
export async function markFollowingSeen(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET following_last_seen_at = now() WHERE id = $1`, [userId]);
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
