import type { ModerationActionRecord } from "@habeshalive/shared";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { notify } from "../notifications/service.js";

export async function banUser(actorId: string, targetUserId: string, reason?: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ is_banned: boolean }>(
      `SELECT is_banned FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId]
    );
    if (!rows[0]) throw new AppError(404, "User not found");
    if (rows[0].is_banned) throw new AppError(400, "User is already banned");

    await client.query(`UPDATE users SET is_banned = TRUE, updated_at = now() WHERE id = $1`, [targetUserId]);
    await client.query(
      `INSERT INTO moderation_actions (actor_id, target_user_id, action, reason) VALUES ($1, $2, 'ban', $3)`,
      [actorId, targetUserId, reason ?? null]
    );
    await logAdminAction(actorId, "user.ban", "user", targetUserId, { reason, client });
    await client.query("COMMIT");
    await notify(targetUserId, "moderation_action", "Your account was banned", {
      body: reason,
      linkUrl: "/safety-center",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function unbanUser(actorId: string, targetUserId: string, reason?: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ is_banned: boolean }>(
      `SELECT is_banned FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId]
    );
    if (!rows[0]) throw new AppError(404, "User not found");
    if (!rows[0].is_banned) throw new AppError(400, "User is not banned");

    await client.query(`UPDATE users SET is_banned = FALSE, updated_at = now() WHERE id = $1`, [targetUserId]);
    await client.query(
      `INSERT INTO moderation_actions (actor_id, target_user_id, action, reason) VALUES ($1, $2, 'unban', $3)`,
      [actorId, targetUserId, reason ?? null]
    );
    await logAdminAction(actorId, "user.unban", "user", targetUserId, { reason, client });
    await client.query("COMMIT");
    await notify(targetUserId, "moderation_action", "Your account was unbanned", {
      body: reason,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// moderation_actions has been written to since the ban/unban endpoints
// shipped but nothing ever read it back for a human — this is that
// missing read side.
export async function listModerationActions(limit = 100): Promise<ModerationActionRecord[]> {
  const { rows } = await pool.query<{
    id: string;
    actor_username: string;
    target_username: string;
    action: ModerationActionRecord["action"];
    reason: string | null;
    duration_seconds: number | null;
    created_at: string;
  }>(
    `SELECT ma.id, actor.username AS actor_username, target.username AS target_username,
            ma.action, ma.reason, ma.duration_seconds, ma.created_at
     FROM moderation_actions ma
     JOIN users actor ON actor.id = ma.actor_id
     JOIN users target ON target.id = ma.target_user_id
     ORDER BY ma.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    actorUsername: row.actor_username,
    targetUsername: row.target_username,
    action: row.action,
    reason: row.reason,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
  }));
}
