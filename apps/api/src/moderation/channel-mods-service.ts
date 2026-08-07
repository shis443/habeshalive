import type { ChannelBlock, ChannelModerator } from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

// Module 5 — per-channel moderator RBAC, the missing "creator X grants
// viewer Y moderator powers on X's channel specifically" layer alongside
// the existing platform-wide role_permission_grants (admin/config-
// service.ts's sibling concept, keyed on users.role instead of a
// per-creator grant). See db/migrations/0036's own comment for why this
// is all-or-nothing per channel rather than a second per-action
// permission dimension within it.

export async function isChannelModerator(creatorId: string, userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM channel_moderator_grants WHERE creator_id = $1 AND moderator_id = $2`,
    [creatorId, userId]
  );
  return rows.length > 0;
}

// Granting/revoking moderator status stays exclusively with the channel
// owner — a channel moderator being able to grant other moderators (or
// remove themselves/others) would be a real privilege-escalation loop,
// unlike blocking a viewer (assertCanManageChannel below), which a
// granted moderator should genuinely be able to do.
export function assertIsChannelOwner(creatorId: string, actorId: string): void {
  if (actorId !== creatorId) throw new AppError(403, "Only the channel owner can do this");
}

// Same three-way check as chat/service.ts's assertCanModerateStream
// (owner, platform staff, or a granted channel moderator), duplicated
// rather than shared because that one needs a live streamId to resolve
// creator_id from and this one already has creatorId directly (channel
// moderator grants/blocks aren't tied to any specific broadcast).
export async function assertCanManageChannel(creatorId: string, actorId: string): Promise<void> {
  if (actorId === creatorId) return;
  if (await isChannelModerator(creatorId, actorId)) return;
  const { rows } = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [actorId]);
  const role = rows[0]?.role;
  if (role === "moderator" || role === "super_admin" || role === "admin") return;
  throw new AppError(403, "Only the channel owner or a channel moderator can do this");
}

export async function isBlockedFromChannel(creatorId: string, userId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM channel_blocks WHERE creator_id = $1 AND blocked_user_id = $2`, [
    creatorId,
    userId,
  ]);
  return rows.length > 0;
}

interface ModeratorRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  granted_at: string;
}

export async function listChannelModerators(creatorId: string, actorId: string): Promise<ChannelModerator[]> {
  await assertCanManageChannel(creatorId, actorId);
  const { rows } = await pool.query<ModeratorRow>(
    `SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url, g.granted_at
     FROM channel_moderator_grants g
     JOIN users u ON u.id = g.moderator_id
     WHERE g.creator_id = $1
     ORDER BY g.granted_at ASC`,
    [creatorId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    grantedAt: r.granted_at,
  }));
}

export async function grantChannelModerator(
  creatorId: string,
  actorId: string,
  moderatorUsername: string
): Promise<ChannelModerator> {
  assertIsChannelOwner(creatorId, actorId);
  const { rows: userRows } = await pool.query<{ id: string; display_name: string; avatar_url: string | null }>(
    `SELECT id, display_name, avatar_url FROM users WHERE username = $1`,
    [moderatorUsername]
  );
  const target = userRows[0];
  if (!target) throw new AppError(404, "No user with that username");
  if (target.id === creatorId) throw new AppError(400, "You can't grant yourself channel moderator");

  const { rows } = await pool.query<{ granted_at: string }>(
    `INSERT INTO channel_moderator_grants (creator_id, moderator_id) VALUES ($1, $2)
     ON CONFLICT (creator_id, moderator_id) DO UPDATE SET granted_at = channel_moderator_grants.granted_at
     RETURNING granted_at`,
    [creatorId, target.id]
  );

  return {
    userId: target.id,
    username: moderatorUsername,
    displayName: target.display_name,
    avatarUrl: target.avatar_url,
    grantedAt: rows[0]!.granted_at,
  };
}

export async function revokeChannelModerator(
  creatorId: string,
  actorId: string,
  moderatorUserId: string
): Promise<void> {
  assertIsChannelOwner(creatorId, actorId);
  const { rows } = await pool.query(
    `DELETE FROM channel_moderator_grants WHERE creator_id = $1 AND moderator_id = $2 RETURNING id`,
    [creatorId, moderatorUserId]
  );
  if (!rows[0]) throw new AppError(404, "That user isn't a moderator on your channel");
}

interface BlockRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export async function listChannelBlocks(creatorId: string, actorId: string): Promise<ChannelBlock[]> {
  await assertCanManageChannel(creatorId, actorId);
  const { rows } = await pool.query<BlockRow>(
    `SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url, b.created_at
     FROM channel_blocks b
     JOIN users u ON u.id = b.blocked_user_id
     WHERE b.creator_id = $1
     ORDER BY b.created_at DESC`,
    [creatorId]
  );
  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    createdAt: r.created_at,
  }));
}

// actorId is whoever clicked "block" (creator or a channel/platform
// moderator) — recorded on the row (blocked_by) but the block itself is
// always scoped to creatorId's channel, not actorId's, so a moderator
// blocking someone blocks them from the channel they moderate, not their
// own.
export async function blockViewerFromChannel(
  creatorId: string,
  actorId: string,
  targetUsername: string
): Promise<ChannelBlock> {
  await assertCanManageChannel(creatorId, actorId);
  const { rows: userRows } = await pool.query<{ id: string; display_name: string; avatar_url: string | null }>(
    `SELECT id, display_name, avatar_url FROM users WHERE username = $1`,
    [targetUsername]
  );
  const target = userRows[0];
  if (!target) throw new AppError(404, "No user with that username");
  if (target.id === creatorId) throw new AppError(400, "You can't block yourself from your own channel");

  const { rows } = await pool.query<{ created_at: string }>(
    `INSERT INTO channel_blocks (creator_id, blocked_user_id, blocked_by) VALUES ($1, $2, $3)
     ON CONFLICT (creator_id, blocked_user_id) DO UPDATE SET blocked_by = $3
     RETURNING created_at`,
    [creatorId, target.id, actorId]
  );

  return {
    userId: target.id,
    username: targetUsername,
    displayName: target.display_name,
    avatarUrl: target.avatar_url,
    createdAt: rows[0]!.created_at,
  };
}

export async function unblockViewerFromChannel(
  creatorId: string,
  actorId: string,
  blockedUserId: string
): Promise<void> {
  await assertCanManageChannel(creatorId, actorId);
  const { rows } = await pool.query(
    `DELETE FROM channel_blocks WHERE creator_id = $1 AND blocked_user_id = $2 RETURNING id`,
    [creatorId, blockedUserId]
  );
  if (!rows[0]) throw new AppError(404, "That user isn't blocked from your channel");
}
