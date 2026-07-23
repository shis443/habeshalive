import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

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
    await client.query("COMMIT");
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
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
