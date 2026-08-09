import { randomUUID } from "node:crypto";
import type { KycAdminItem, KycIdType, KycStatus } from "@birq/shared";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { getSignedVodUrl, isObjectStorageConfigured, uploadObject } from "../common/object-storage.js";
import { notify } from "../notifications/service.js";

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

interface SubmissionRow {
  id: string;
  id_type: KycIdType;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  submitted_at: string;
}

// One pending submission at a time — same "no stacking" posture as
// creator-applications' pending-application check. Re-submission after a
// rejection is fine (a fresh row, the rejected one stays in history).
export async function submitKyc(
  userId: string,
  idType: KycIdType,
  document: { buffer: Buffer; contentType: string }
): Promise<void> {
  if (!isObjectStorageConfigured) {
    throw new AppError(503, "Identity verification uploads aren't available right now — try again later.");
  }

  const ext = ALLOWED_CONTENT_TYPES[document.contentType];
  if (!ext) throw new AppError(400, "Upload a JPEG, PNG, or PDF of your ID.");
  if (document.buffer.byteLength === 0) throw new AppError(400, "The uploaded file is empty.");
  if (document.buffer.byteLength > MAX_DOCUMENT_BYTES) throw new AppError(400, "File is too large (max 10MB).");

  const { rows: existingPending } = await pool.query(
    `SELECT 1 FROM kyc_submissions WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );
  if (existingPending[0]) throw new AppError(400, "You already have a submission awaiting review.");

  const { rows: existingApproved } = await pool.query(
    `SELECT 1 FROM kyc_submissions WHERE user_id = $1 AND status = 'approved'`,
    [userId]
  );
  if (existingApproved[0]) throw new AppError(400, "Your identity is already verified.");

  // kyc/ prefix — shares the VOD bucket (see 0032_kyc.sql's comment) but
  // stays out of the vods/ key namespace those routes/cleanup jobs sweep.
  const key = `kyc/${userId}/${randomUUID()}.${ext}`;
  await uploadObject(key, document.buffer, document.contentType);

  await pool.query(
    `INSERT INTO kyc_submissions (user_id, id_type, document_key) VALUES ($1, $2, $3)`,
    [userId, idType, key]
  );
}

export async function getMyKycStatus(userId: string): Promise<KycStatus> {
  const { rows } = await pool.query<SubmissionRow>(
    `SELECT id, id_type, status, rejection_reason, submitted_at
     FROM kyc_submissions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return { status: "not_submitted", idType: null, rejectionReason: null, submittedAt: null };
  return {
    status: row.status,
    idType: row.id_type,
    rejectionReason: row.rejection_reason,
    submittedAt: row.submitted_at,
  };
}

// Module 1.3/1.4's actual payout gate — called from wallet/service.ts's
// requestPayout, but only enforced when admin/config-service.ts's
// getKycRequiredForPayouts() is on (defaults off, see 0032_kyc.sql).
export async function hasApprovedKyc(userId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM kyc_submissions WHERE user_id = $1 AND status = 'approved'`, [
    userId,
  ]);
  return rows.length > 0;
}

// --- Admin ---

interface AdminSubmissionRow extends SubmissionRow {
  user_id: string;
  username: string;
  reviewer_username: string | null;
  reviewed_at: string | null;
}

export async function listKycSubmissions(status?: "pending" | "approved" | "rejected"): Promise<KycAdminItem[]> {
  const { rows } = await pool.query<AdminSubmissionRow>(
    `SELECT k.id, k.user_id, u.username, k.id_type, k.status, k.rejection_reason,
            k.submitted_at, k.reviewed_at, r.username AS reviewer_username
     FROM kyc_submissions k
     JOIN users u ON u.id = k.user_id
     LEFT JOIN users r ON r.id = k.reviewed_by
     WHERE ($1::text IS NULL OR k.status = $1)
     ORDER BY k.submitted_at ASC`,
    [status ?? null]
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    idType: row.id_type,
    status: row.status,
    rejectionReason: row.rejection_reason,
    reviewerUsername: row.reviewer_username,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  }));
}

export async function getKycDocumentUrl(submissionId: string): Promise<string> {
  const { rows } = await pool.query<{ document_key: string }>(
    `SELECT document_key FROM kyc_submissions WHERE id = $1`,
    [submissionId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "Submission not found");
  return getSignedVodUrl(row.document_key);
}

export async function approveKyc(adminId: string, submissionId: string): Promise<void> {
  const { rows } = await pool.query<{ user_id: string }>(
    `UPDATE kyc_submissions SET status = 'approved', reviewed_by = $1, reviewed_at = now()
     WHERE id = $2 AND status = 'pending'
     RETURNING user_id`,
    [adminId, submissionId]
  );
  if (!rows[0]) throw new AppError(404, "Submission not found or already reviewed");
  await logAdminAction(adminId, "kyc.approve", "kyc_submission", submissionId);
  await notify(rows[0].user_id, "kyc_approved", "Your identity verification was approved", {
    body: "You're all set for payouts.",
    linkUrl: "/settings",
  });
}

export async function rejectKyc(adminId: string, submissionId: string, reason: string): Promise<void> {
  const { rows } = await pool.query<{ user_id: string }>(
    `UPDATE kyc_submissions SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = now()
     WHERE id = $3 AND status = 'pending'
     RETURNING user_id`,
    [reason, adminId, submissionId]
  );
  if (!rows[0]) throw new AppError(404, "Submission not found or already reviewed");
  await logAdminAction(adminId, "kyc.reject", "kyc_submission", submissionId, { reason });
  await notify(rows[0].user_id, "kyc_rejected", "Your identity verification needs another look", {
    body: reason,
    linkUrl: "/settings",
  });
}
