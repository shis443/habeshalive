import type { Announcement, AnnouncementAdminItem, CreateAnnouncementInput } from "@habeshalive/shared";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface AnnouncementRow {
  id: string;
  body: string;
  action_label: string | null;
  action_url: string | null;
  created_at: string;
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    body: row.body,
    actionLabel: row.action_label,
    actionUrl: row.action_url,
    createdAt: row.created_at,
  };
}

// Platform-wide only (see db/migrations/0023's comment) — every active row
// is shown to every viewer. Small N expected (this is a rare admin action,
// not per-stream), so no pagination.
export async function listActiveAnnouncements(): Promise<Announcement[]> {
  const { rows } = await pool.query<AnnouncementRow>(
    `SELECT id, body, action_label, action_url, created_at
     FROM announcements WHERE is_active = TRUE ORDER BY created_at DESC`
  );
  return rows.map(toAnnouncement);
}

export async function listAnnouncementsAdmin(): Promise<AnnouncementAdminItem[]> {
  const { rows } = await pool.query<AnnouncementRow & { is_active: boolean; created_by_username: string }>(
    `SELECT a.id, a.body, a.action_label, a.action_url, a.created_at, a.is_active, u.username AS created_by_username
     FROM announcements a JOIN users u ON u.id = a.created_by
     ORDER BY a.created_at DESC`
  );
  return rows.map((row) => ({ ...toAnnouncement(row), isActive: row.is_active, createdByUsername: row.created_by_username }));
}

export async function createAnnouncement(adminId: string, input: CreateAnnouncementInput): Promise<Announcement> {
  const { rows } = await pool.query<AnnouncementRow>(
    `INSERT INTO announcements (body, action_label, action_url, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, body, action_label, action_url, created_at`,
    [input.body, input.actionLabel ?? null, input.actionUrl ?? null, adminId]
  );
  await logAdminAction(adminId, "announcement.create", "announcement", rows[0]!.id, {
    metadata: { body: input.body },
  });
  return toAnnouncement(rows[0]!);
}

export async function deactivateAnnouncement(adminId: string, id: string): Promise<void> {
  const { rowCount } = await pool.query(`UPDATE announcements SET is_active = FALSE WHERE id = $1`, [id]);
  if (!rowCount) throw new AppError(404, "Announcement not found");
  await logAdminAction(adminId, "announcement.deactivate", "announcement", id);
}
