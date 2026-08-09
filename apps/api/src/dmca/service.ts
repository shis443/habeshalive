import type { DmcaContentType, DmcaReport, SubmitCounterNoticeInput, SubmitDmcaReportInput } from "@birq/shared";
import { logAdminAction } from "../admin/audit.js";
import { AppError } from "../common/errors.js";
import { pool } from "../common/db.js";

interface DmcaReportRow {
  id: string;
  reporter_name: string;
  reporter_email: string;
  content_type: DmcaContentType;
  content_id: string;
  content_url: string | null;
  copyrighted_work_description: string;
  status: DmcaReport["status"];
  resolution_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function toDmcaReport(row: DmcaReportRow): DmcaReport {
  return {
    id: row.id,
    reporterName: row.reporter_name,
    reporterEmail: row.reporter_email,
    contentType: row.content_type,
    contentId: row.content_id,
    contentUrl: row.content_url,
    copyrightedWorkDescription: row.copyrighted_work_description,
    status: row.status,
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

// Deliberately unauthenticated (see dmca/routes.ts) — a rights holder
// reporting infringement often has no account on this platform at all.
// good_faith_statement/accuracy_statement are the two statements
// 17 U.S.C. 512(c)(3) actually requires; this function doesn't validate
// their legal sufficiency, only that the submitter affirmatively checked
// both (schema-enforced booleans, see submitDmcaReportSchema).
export async function submitDmcaReport(input: SubmitDmcaReportInput): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO dmca_reports (
       reporter_name, reporter_email, content_type, content_id, content_url,
       copyrighted_work_description, good_faith_statement, accuracy_statement, signature
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.reporterName,
      input.reporterEmail,
      input.contentType,
      input.contentId,
      input.contentUrl ?? null,
      input.copyrightedWorkDescription,
      input.goodFaithStatement,
      input.accuracyStatement,
      input.signature,
    ]
  );
  return { id: rows[0]!.id };
}

export async function listDmcaReports(status?: DmcaReport["status"]): Promise<DmcaReport[]> {
  const { rows } = await pool.query<DmcaReportRow>(
    status
      ? `SELECT * FROM dmca_reports WHERE status = $1 ORDER BY created_at DESC`
      : `SELECT * FROM dmca_reports ORDER BY created_at DESC`,
    status ? [status] : []
  );
  return rows.map(toDmcaReport);
}

async function setContentRemoved(contentType: DmcaContentType, contentId: string, removed: boolean): Promise<void> {
  const value = removed ? "now()" : "NULL";
  if (contentType === "vod") {
    await pool.query(`UPDATE stream_vods SET dmca_removed_at = ${value} WHERE id = $1`, [contentId]);
  } else if (contentType === "clip") {
    await pool.query(`UPDATE clips SET dmca_removed_at = ${value} WHERE id = $1`, [contentId]);
  }
  // 'stream' reports (a still-live broadcast) aren't auto-actioned here —
  // by the time a report is reviewed the stream has almost always already
  // ended on its own; an admin who judges an active stream needs to be cut
  // immediately already has moderation/actions-service.ts's forceEndStream
  // for that, same as any other live-content violation.
}

// status: 'valid' actually removes the content (sets dmca_removed_at,
// gating vods/service.ts's and clips/service.ts's public listing
// queries); 'invalid' dismisses the report with no content action;
// 'reinstated' (used after a counter-notice's wait period — see
// dmca_counter_notices' own migration comment) clears a prior removal.
export async function resolveDmcaReport(
  reportId: string,
  reviewerId: string,
  status: "valid" | "invalid" | "reinstated",
  resolutionNotes?: string
): Promise<void> {
  const { rows } = await pool.query<{ content_type: DmcaContentType; content_id: string }>(
    `UPDATE dmca_reports SET status = $1, reviewed_by = $2, reviewed_at = now(), resolution_notes = $3
     WHERE id = $4
     RETURNING content_type, content_id`,
    [status, reviewerId, resolutionNotes ?? null, reportId]
  );
  const report = rows[0];
  if (!report) throw new AppError(404, "Report not found");

  if (status === "valid") {
    await setContentRemoved(report.content_type, report.content_id, true);
  } else if (status === "reinstated") {
    await setContentRemoved(report.content_type, report.content_id, false);
  }

  await logAdminAction(reviewerId, `dmca_report.${status}`, "dmca_report", reportId, {
    metadata: { contentType: report.content_type, contentId: report.content_id },
  });
}

// respondentUserId comes from the authenticated caller (see routes.ts),
// not the request body — a counter-notice's whole legal weight rests on
// it coming from whoever the takedown actually silenced, not on a
// self-reported identity in a form field.
export async function submitCounterNotice(
  reportId: string,
  respondentUserId: string,
  input: SubmitCounterNoticeInput
): Promise<{ id: string }> {
  const { rows: reportRows } = await pool.query<{ status: string }>(`SELECT status FROM dmca_reports WHERE id = $1`, [
    reportId,
  ]);
  if (!reportRows[0]) throw new AppError(404, "Report not found");
  if (reportRows[0].status !== "valid") {
    throw new AppError(400, "Only a report that resulted in removal can be counter-noticed");
  }

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO dmca_counter_notices (
       dmca_report_id, respondent_user_id, respondent_name, respondent_address,
       consent_to_jurisdiction, good_faith_statement, signature
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      reportId,
      respondentUserId,
      input.respondentName,
      input.respondentAddress,
      input.consentToJurisdiction,
      input.goodFaithStatement,
      input.signature,
    ]
  );
  await pool.query(`UPDATE dmca_reports SET status = 'counter_noticed' WHERE id = $1`, [reportId]);
  return { id: rows[0]!.id };
}
