import type { Report, ResolveReportInput, SubmitReportInput } from "@habeshalive/shared";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface ReportRow {
  id: string;
  reporter_id: string;
  reporter_username: string;
  target_type: Report["targetType"];
  target_id: string;
  reason: Report["reason"];
  details: string | null;
  status: Report["status"];
  created_at: string;
}

function mapRow(row: ReportRow): Report {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    reporterUsername: row.reporter_username,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function submitReport(reporterId: string, input: SubmitReportInput): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason, details)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [reporterId, input.targetType, input.targetId, input.reason, input.details ?? null]
  );
  return { id: rows[0]!.id };
}

export async function listReports(limit = 50): Promise<Report[]> {
  const { rows } = await pool.query<ReportRow>(
    `SELECT r.id, r.reporter_id, u.username AS reporter_username, r.target_type, r.target_id,
            r.reason, r.details, r.status, r.created_at
     FROM reports r
     JOIN users u ON u.id = r.reporter_id
     WHERE r.status = 'pending'
     ORDER BY r.created_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows.map(mapRow);
}

export async function resolveReport(reportId: string, reviewerId: string, input: ResolveReportInput): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE reports SET status = $1, reviewed_by = $2, reviewed_at = now()
     WHERE id = $3 AND status = 'pending'`,
    [input.status, reviewerId, reportId]
  );
  if (rowCount === 0) throw new AppError(404, "Report not found or already reviewed");
  await logAdminAction(reviewerId, `report.${input.status}`, "report", reportId);
}
