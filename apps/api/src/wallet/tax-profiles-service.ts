import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { logAdminAction } from "../admin/audit.js";

export type TaxResidency = "et_resident" | "diaspora" | "other";
export type TaxFormType = "none" | "w8ben" | "w9";
export type TaxProfileStatus = "pending" | "verified" | "rejected" | "expired";

export interface TaxProfile {
  id: string;
  creatorId: string;
  residency: TaxResidency;
  tin: string | null;
  formType: TaxFormType | null;
  withholdingBps: number;
  status: TaxProfileStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

interface TaxProfileRow {
  id: string;
  creator_id: string;
  residency: TaxResidency;
  tin: string | null;
  form_type: TaxFormType | null;
  withholding_bps: number;
  status: TaxProfileStatus;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

function mapRow(row: TaxProfileRow): TaxProfile {
  return {
    id: row.id,
    creatorId: row.creator_id,
    residency: row.residency,
    tin: row.tin,
    formType: row.form_type,
    withholdingBps: row.withholding_bps,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
  };
}

const SELECT_PROFILE = `
  SELECT id, creator_id, residency, tin, form_type, withholding_bps, status, effective_from, effective_to, created_at
  FROM creator_tax_profiles
`;

export interface SubmitTaxProfileInput {
  residency: TaxResidency;
  tin?: string;
  formType?: TaxFormType;
  formDocumentKey?: string;
}

// Versioned, not upserted in place — a creator who moves between
// residencies keeps the old row for the periods it applied to (0060's
// migration comment). Submitting a new one closes out whichever row is
// currently in force (effective_to IS NULL) and opens a fresh 'pending'
// one, exactly like KYC's re-submission-after-rejection flow.
export async function submitTaxProfile(creatorId: string, input: SubmitTaxProfileInput): Promise<TaxProfile> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE creator_tax_profiles SET effective_to = now() WHERE creator_id = $1 AND effective_to IS NULL`,
      [creatorId]
    );
    const { rows } = await client.query<TaxProfileRow>(
      `INSERT INTO creator_tax_profiles (creator_id, residency, tin, form_type, form_document_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, creator_id, residency, tin, form_type, withholding_bps, status, effective_from, effective_to, created_at`,
      [creatorId, input.residency, input.tin ?? null, input.formType ?? "none", input.formDocumentKey ?? null]
    );
    await client.query("COMMIT");
    return mapRow(rows[0]!);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getCurrentTaxProfile(creatorId: string): Promise<TaxProfile | null> {
  const { rows } = await pool.query<TaxProfileRow>(
    `${SELECT_PROFILE} WHERE creator_id = $1 AND effective_to IS NULL`,
    [creatorId]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

// The batch eligibility check's own definition of "tax profile in
// force" — verified, currently in force, and (for a diaspora creator who
// must self-certify a withholding form) not sitting in a half-finished
// 'none' form_type state.
export async function hasVerifiedTaxProfile(creatorId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM creator_tax_profiles WHERE creator_id = $1 AND effective_to IS NULL AND status = 'verified'`,
    [creatorId]
  );
  return rows.length > 0;
}

export async function listPendingTaxProfiles(): Promise<TaxProfile[]> {
  const { rows } = await pool.query<TaxProfileRow>(
    `${SELECT_PROFILE} WHERE status = 'pending' AND effective_to IS NULL ORDER BY created_at ASC`
  );
  return rows.map(mapRow);
}

export async function verifyTaxProfile(adminId: string, profileId: string, withholdingBps: number): Promise<void> {
  const { rows } = await pool.query<{ creator_id: string }>(
    `UPDATE creator_tax_profiles SET status = 'verified', withholding_bps = $1, reviewed_by = $2, reviewed_at = now()
     WHERE id = $3 AND status = 'pending'
     RETURNING creator_id`,
    [withholdingBps, adminId, profileId]
  );
  if (!rows[0]) throw new AppError(404, "Tax profile not found or already reviewed");
  await logAdminAction(adminId, "tax_profile.verify", "creator_tax_profile", profileId, {
    before: { status: "pending" },
    after: { status: "verified", withholdingBps },
  });
}

export async function rejectTaxProfile(adminId: string, profileId: string, reason: string): Promise<void> {
  const { rows } = await pool.query<{ creator_id: string }>(
    `UPDATE creator_tax_profiles SET status = 'rejected', reviewed_by = $1, reviewed_at = now()
     WHERE id = $2 AND status = 'pending'
     RETURNING creator_id`,
    [adminId, profileId]
  );
  if (!rows[0]) throw new AppError(404, "Tax profile not found or already reviewed");
  await logAdminAction(adminId, "tax_profile.reject", "creator_tax_profile", profileId, {
    reason,
    before: { status: "pending" },
    after: { status: "rejected" },
  });
}
