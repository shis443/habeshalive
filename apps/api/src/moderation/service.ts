import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { AM_BLOCKLIST, EN_BLOCKLIST } from "./wordlists.js";

const ALL_TERMS = [...EN_BLOCKLIST, ...AM_BLOCKLIST];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Single-word terms match on word boundaries (so "assassin" doesn't trip
// on "ass"); multi-word phrases ("kill yourself") match as a plain
// substring since \b boundaries around a phrase with internal spaces work
// the same way in practice — kept as one code path either way.
export function scanText(text: string): string[] {
  const matched: string[] = [];
  for (const term of ALL_TERMS) {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "iu");
    if (pattern.test(text)) matched.push(term);
  }
  return matched;
}

export type ModerationContentType = "stream_title" | "gift_message";

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
  const matches = scanText(text);
  if (matches.length === 0) return;

  await pool.query(
    `INSERT INTO moderation_flags (content_type, content_id, author_id, text_snapshot, matched_terms)
     VALUES ($1, $2, $3, $4, $5)`,
    [contentType, contentId, authorId, text, matches]
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
}
