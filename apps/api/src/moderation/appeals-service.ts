import type { Appeal } from "@birq/shared";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { unbanUser } from "./actions-service.js";

interface AppealRow {
  id: string;
  user_id: string;
  username: string;
  reason: string;
  status: Appeal["status"];
  created_at: string;
}

function mapRow(row: AppealRow): Appeal {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function submitAppeal(userId: string, reason: string): Promise<{ id: string }> {
  const { rows } = await pool.query<{ is_banned: boolean }>(`SELECT is_banned FROM users WHERE id = $1`, [userId]);
  if (!rows[0]?.is_banned) throw new AppError(400, "Only banned accounts can submit an appeal");

  const { rows: existing } = await pool.query<{ id: string }>(
    `SELECT id FROM appeals WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  if (existing[0]) throw new AppError(400, "You already have a pending appeal");

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO appeals (user_id, reason) VALUES ($1, $2) RETURNING id`,
    [userId, reason]
  );
  return { id: inserted.rows[0]!.id };
}

export async function listAppeals(limit = 50): Promise<Appeal[]> {
  const { rows } = await pool.query<AppealRow>(
    `SELECT a.id, a.user_id, u.username, a.reason, a.status, a.created_at
     FROM appeals a
     JOIN users u ON u.id = a.user_id
     WHERE a.status = 'pending'
     ORDER BY a.created_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows.map(mapRow);
}

export async function resolveAppeal(appealId: string, reviewerId: string, action: "approve" | "deny"): Promise<void> {
  const { rows } = await pool.query<{ user_id: string; status: string }>(
    `SELECT user_id, status FROM appeals WHERE id = $1`,
    [appealId]
  );
  const appeal = rows[0];
  if (!appeal) throw new AppError(404, "Appeal not found");
  if (appeal.status !== "pending") throw new AppError(400, "Appeal already reviewed");

  const status = action === "approve" ? "approved" : "denied";
  const { rowCount } = await pool.query(
    `UPDATE appeals SET status = $1, reviewed_by = $2, reviewed_at = now()
     WHERE id = $3 AND status = 'pending'`,
    [status, reviewerId, appealId]
  );
  if (rowCount === 0) throw new AppError(404, "Appeal not found or already reviewed");
  await logAdminAction(reviewerId, `appeal.${action}`, "appeal", appealId);

  if (action === "approve") {
    await unbanUser(reviewerId, appeal.user_id, "Appeal approved");
  }
}
