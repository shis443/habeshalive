import type {
  CreatorApplicationAdminItem,
  CreatorApplicationCapStatus,
  MyCreatorApplication,
  SubmitCreatorApplicationInput,
} from "@habeshalive/shared";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface ApplicationRow {
  id: string;
  status: "pending" | "approved" | "rejected";
  application_text: string;
  social_links: string | null;
  created_at: string;
  reviewed_at: string | null;
}

// The actual A.4 launch-gate check — called from streams/service.ts's
// ensureCreatorProfile() right before it would create a NEW creator
// profile. Anyone who already has one (existing creators, grandfathered
// by db/migrations/0018) never reaches this check at all.
export async function isApprovedCreator(userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM creator_applications WHERE applicant_id = $1 AND status = 'approved'`,
    [userId]
  );
  return rows.length > 0;
}

export async function getApprovedCreatorCap(): Promise<number> {
  const { rows } = await pool.query<{ approved_creator_cap: number }>(
    `SELECT approved_creator_cap FROM platform_config WHERE id = TRUE`
  );
  return rows[0]!.approved_creator_cap;
}

export async function getCapStatus(): Promise<CreatorApplicationCapStatus> {
  const [{ rows: capRows }, { rows: countRows }] = await Promise.all([
    pool.query<{ approved_creator_cap: number }>(`SELECT approved_creator_cap FROM platform_config WHERE id = TRUE`),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM creator_applications WHERE status = 'approved'`),
  ]);
  return { cap: capRows[0]!.approved_creator_cap, approvedCount: Number(countRows[0]!.count) };
}

// A user can hold at most one pending application (enforced at the DB
// level too, see db/migrations/0018's partial unique index) — re-applying
// after a rejection is fine, stacking pending ones isn't.
export async function submitApplication(
  userId: string,
  input: SubmitCreatorApplicationInput
): Promise<MyCreatorApplication> {
  const { rows: existingApproved } = await pool.query(
    `SELECT 1 FROM creator_applications WHERE applicant_id = $1 AND status = 'approved'`,
    [userId]
  );
  if (existingApproved[0]) throw new AppError(400, "You're already an approved creator.");

  const { rows: existingPending } = await pool.query(
    `SELECT 1 FROM creator_applications WHERE applicant_id = $1 AND status = 'pending'`,
    [userId]
  );
  if (existingPending[0]) throw new AppError(400, "You already have a pending application.");

  const { rows } = await pool.query<ApplicationRow>(
    `INSERT INTO creator_applications (applicant_id, application_text, social_links)
     VALUES ($1, $2, $3)
     RETURNING id, status, application_text, social_links, created_at, reviewed_at`,
    [userId, input.applicationText, input.socialLinks ?? null]
  );
  return mapMine(rows[0]!);
}

export async function getMyApplication(userId: string): Promise<MyCreatorApplication | null> {
  const { rows } = await pool.query<ApplicationRow>(
    `SELECT id, status, application_text, social_links, created_at, reviewed_at
     FROM creator_applications WHERE applicant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] ? mapMine(rows[0]) : null;
}

function mapMine(row: ApplicationRow): MyCreatorApplication {
  return {
    id: row.id,
    status: row.status,
    applicationText: row.application_text,
    socialLinks: row.social_links,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

// --- Admin ---

interface AdminApplicationRow extends ApplicationRow {
  applicant_id: string;
  applicant_username: string;
  reviewer_username: string | null;
}

export async function listApplications(status?: "pending" | "approved" | "rejected"): Promise<CreatorApplicationAdminItem[]> {
  const { rows } = await pool.query<AdminApplicationRow>(
    `SELECT ca.id, ca.status, ca.application_text, ca.social_links, ca.created_at, ca.reviewed_at,
            ca.applicant_id, u.username AS applicant_username, r.username AS reviewer_username
     FROM creator_applications ca
     JOIN users u ON u.id = ca.applicant_id
     LEFT JOIN users r ON r.id = ca.reviewer_id
     WHERE ($1::text IS NULL OR ca.status = $1)
     ORDER BY ca.created_at ASC`,
    [status ?? null]
  );
  return rows.map((row) => ({
    id: row.id,
    applicantId: row.applicant_id,
    applicantUsername: row.applicant_username,
    applicationText: row.application_text,
    socialLinks: row.social_links,
    status: row.status,
    reviewerUsername: row.reviewer_username,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }));
}

export async function approveApplication(adminId: string, applicationId: string): Promise<void> {
  const { approvedCount, cap } = await getCapStatus();
  if (approvedCount >= cap) {
    throw new AppError(400, `Approved creator cap (${cap}) reached — raise it in Settings before approving more.`);
  }

  const { rowCount } = await pool.query(
    `UPDATE creator_applications SET status = 'approved', reviewer_id = $1, reviewed_at = now()
     WHERE id = $2 AND status = 'pending'`,
    [adminId, applicationId]
  );
  if (!rowCount) throw new AppError(404, "Application not found or already reviewed");
  await logAdminAction(adminId, "creator_application.approve", "creator_application", applicationId);
}

export async function rejectApplication(adminId: string, applicationId: string, reason?: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE creator_applications SET status = 'rejected', reviewer_id = $1, reviewed_at = now()
     WHERE id = $2 AND status = 'pending'`,
    [adminId, applicationId]
  );
  if (!rowCount) throw new AppError(404, "Application not found or already reviewed");
  await logAdminAction(adminId, "creator_application.reject", "creator_application", applicationId, { reason });
}
