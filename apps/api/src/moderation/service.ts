import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { imageModerationClient } from "./image-moderation-client.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Reads the live blocklist from the DB (see db/migrations/0013 and the
// admin-facing CRUD in blocklist-service.ts) rather than a static file —
// an admin can add/remove terms without a code deploy. No caching: this
// runs on every stream-title/gift-message submission, which is real but
// still low-enough traffic that a single indexed SELECT is cheap, same
// "no caching layer" reasoning already used elsewhere in admin/service.ts.
async function getBlocklistTerms(): Promise<string[]> {
  const { rows } = await pool.query<{ term: string }>(`SELECT term FROM blocklist_terms`);
  return rows.map((row) => row.term);
}

// Boundary-matched (so "assassin" doesn't trip on "ass") using Unicode
// letter/number lookarounds rather than \b: JS's \b is defined in terms of
// \w, which is ASCII-only ([A-Za-z0-9_]) regardless of the "u" flag — it
// does NOT treat Amharic (or any non-Latin script) characters as "word"
// characters at all. In practice that means \b never finds a boundary
// inside or around Amharic text, so \bAMHARIC_TERM\b silently matches
// nothing, ever — confirmed empirically before this fix (zero matches
// even for a standalone term with no surrounding text). The lookaround
// form below checks against \p{L}/\p{N} (any script's letters/numbers),
// which correctly finds boundaries for Amharic the same way \b already
// did for English, without changing English matching behavior at all.
export async function scanText(text: string): Promise<string[]> {
  const terms = await getBlocklistTerms();
  const matched: string[] = [];
  for (const term of terms) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "iu");
    if (pattern.test(text)) matched.push(term);
  }
  return matched;
}

export type ModerationContentType =
  | "stream_title"
  | "gift_message"
  | "chat_message"
  | "stream_thumbnail"
  | "donation_message"
  | "avatar_photo";

// Flags content for human review — never blocks or deletes it. The
// content itself already went through by the time this runs (called
// after the insert, see streams/service.ts goLive and wallet/service.ts
// sendGift); this only records that a moderator should look at it.
export async function flagIfMatched(
  contentType: ModerationContentType,
  contentId: string,
  authorId: string,
  text: string
): Promise<void> {
  const matches = await scanText(text);
  if (matches.length === 0) return;

  await pool.query(
    `INSERT INTO moderation_flags (content_type, content_id, author_id, text_snapshot, matched_terms)
     VALUES ($1, $2, $3, $4, $5)`,
    [contentType, contentId, authorId, text, matches]
  );
}

// Same after-the-fact "flag, never block" posture as flagIfMatched(), for
// images instead of text. dataUri is the raw data:<mime>;base64,<payload>
// string produced client-side (GoLivePanel.tsx's canvas.toDataURL) — no
// object storage is wired up for thumbnails yet, so this is what's
// actually stored in streams.thumbnail_url today. Silently no-ops on a
// malformed data URI or a moderation-API failure rather than blocking
// the stream from going live over a moderation-service hiccup; the
// original text-based flagIfMatched() has the same fail-open bias.
export async function flagIfImageMatched(
  contentType: "stream_thumbnail" | "avatar_photo",
  contentId: string,
  authorId: string,
  dataUri: string
): Promise<void> {
  const base64 = dataUri.split(",")[1];
  if (!base64) return;

  let result;
  try {
    result = await imageModerationClient.moderate(Buffer.from(base64, "base64"));
  } catch (err) {
    console.error(`[moderation] image moderation call failed for ${contentType} ${contentId}:`, err);
    return;
  }
  if (result.labels.length === 0) return;

  const matched = result.labels.map((l) => `${l.name} (${l.confidencePercent.toFixed(0)}%)`);
  await pool.query(
    `INSERT INTO moderation_flags (content_type, content_id, author_id, text_snapshot, matched_terms)
     VALUES ($1, $2, $3, $4, $5)`,
    [contentType, contentId, authorId, dataUri, matched]
  );
}

export interface ModerationFlag {
  id: string;
  contentType: ModerationContentType;
  contentId: string;
  authorId: string;
  authorUsername: string;
  textSnapshot: string;
  matchedTerms: string[];
  status: "pending" | "approved" | "removed";
  createdAt: string;
}

interface ModerationFlagRow {
  id: string;
  content_type: ModerationContentType;
  content_id: string;
  author_id: string;
  author_username: string;
  text_snapshot: string;
  matched_terms: string[];
  status: "pending" | "approved" | "removed";
  created_at: string;
}

export async function listModerationQueue(limit = 50): Promise<ModerationFlag[]> {
  const { rows } = await pool.query<ModerationFlagRow>(
    `SELECT mf.id, mf.content_type, mf.content_id, mf.author_id, u.username AS author_username,
            mf.text_snapshot, mf.matched_terms, mf.status, mf.created_at
     FROM moderation_flags mf
     JOIN users u ON u.id = mf.author_id
     WHERE mf.status = 'pending'
     ORDER BY mf.created_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    contentType: row.content_type,
    contentId: row.content_id,
    authorId: row.author_id,
    authorUsername: row.author_username,
    textSnapshot: row.text_snapshot,
    matchedTerms: row.matched_terms,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function resolveModerationFlag(
  flagId: string,
  reviewerId: string,
  action: "approve" | "remove"
): Promise<void> {
  const status = action === "approve" ? "approved" : "removed";
  const { rowCount } = await pool.query(
    `UPDATE moderation_flags SET status = $1, reviewed_by = $2, reviewed_at = now()
     WHERE id = $3 AND status = 'pending'`,
    [status, reviewerId, flagId]
  );
  if (rowCount === 0) throw new AppError(404, "Flag not found or already reviewed");
  await logAdminAction(reviewerId, `moderation_flag.${action}`, "moderation_flag", flagId);
}
