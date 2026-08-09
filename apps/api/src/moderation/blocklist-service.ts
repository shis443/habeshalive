import type { AddBlocklistTermInput, BlocklistTerm } from "@birq/shared";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface BlocklistTermRow {
  id: string;
  term: string;
  language: BlocklistTerm["language"];
  added_by_username: string | null;
  created_at: string;
}

export async function listBlocklistTerms(): Promise<BlocklistTerm[]> {
  const { rows } = await pool.query<BlocklistTermRow>(
    `SELECT bt.id, bt.term, bt.language, u.username AS added_by_username, bt.created_at
     FROM blocklist_terms bt
     LEFT JOIN users u ON u.id = bt.added_by
     ORDER BY bt.language ASC, bt.term ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    term: row.term,
    language: row.language,
    addedByUsername: row.added_by_username,
    createdAt: row.created_at,
  }));
}

export async function addBlocklistTerm(actorId: string, input: AddBlocklistTermInput): Promise<BlocklistTerm> {
  const term = input.term.trim().toLowerCase();
  if (!term) throw new AppError(400, "Term can't be empty");

  let row;
  try {
    const result = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO blocklist_terms (term, language, added_by) VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [term, input.language, actorId]
    );
    row = result.rows[0]!;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw new AppError(409, "That term is already on the blocklist for this language");
    }
    throw err;
  }

  await logAdminAction(actorId, "blocklist.add", "blocklist_term", row.id, {
    metadata: { term, language: input.language },
  });

  const { rows: userRows } = await pool.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [
    actorId,
  ]);
  return {
    id: row.id,
    term,
    language: input.language,
    addedByUsername: userRows[0]?.username ?? null,
    createdAt: row.created_at,
  };
}

export async function removeBlocklistTerm(actorId: string, termId: string): Promise<void> {
  const { rows } = await pool.query<{ term: string; language: string }>(
    `DELETE FROM blocklist_terms WHERE id = $1 RETURNING term, language`,
    [termId]
  );
  if (!rows[0]) throw new AppError(404, "Term not found");
  await logAdminAction(actorId, "blocklist.remove", "blocklist_term", termId, {
    metadata: { term: rows[0].term, language: rows[0].language },
  });
}
