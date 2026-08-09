import type { StreamTagAdminItem } from "@birq/shared";
import type { PoolClient } from "pg";
import { logAdminAction } from "../admin/audit.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

type Queryable = PoolClient | typeof pool;

function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30);
}

// Called inside goLive()'s flow — upserts each tag (ON CONFLICT DO
// NOTHING keeps this idempotent across creators reusing the same tag
// name) and silently drops banned ones. A creator who happens to type a
// banned tag never finds out — same "flag, don't confront" posture as
// everything else in this codebase; their other tags still apply rather
// than failing the whole go-live call over one bad tag.
export async function linkTagsToStream(client: Queryable, streamId: string, rawNames: string[]): Promise<void> {
  const names = [...new Set(rawNames.map(normalizeTagName).filter(Boolean))];
  if (names.length === 0) return;

  for (const name of names) {
    const { rows } = await client.query<{ id: string; is_banned: boolean }>(
      `INSERT INTO stream_tags (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, is_banned`,
      [name]
    );
    const tag = rows[0]!;
    if (tag.is_banned) continue;
    await client.query(
      `INSERT INTO stream_tag_links (stream_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [streamId, tag.id]
    );
  }
}

export async function searchTagNames(prefix: string): Promise<string[]> {
  const normalized = normalizeTagName(prefix);
  if (!normalized) return [];
  const { rows } = await pool.query<{ name: string }>(
    `SELECT name FROM stream_tags WHERE is_banned = FALSE AND name LIKE $1 || '%' ORDER BY name LIMIT 10`,
    [normalized]
  );
  return rows.map((r) => r.name);
}

// --- Admin ---

export async function listTagsAdmin(): Promise<StreamTagAdminItem[]> {
  const { rows } = await pool.query<{ id: string; name: string; is_banned: boolean; usage_count: string; created_at: string }>(
    `SELECT st.id, st.name, st.is_banned, count(stl.stream_id) AS usage_count, st.created_at
     FROM stream_tags st
     LEFT JOIN stream_tag_links stl ON stl.tag_id = st.id
     GROUP BY st.id
     ORDER BY usage_count DESC, st.name ASC`
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isBanned: row.is_banned,
    usageCount: Number(row.usage_count),
    createdAt: row.created_at,
  }));
}

export async function setTagBanned(adminId: string, tagId: string, isBanned: boolean): Promise<void> {
  const { rowCount } = await pool.query(`UPDATE stream_tags SET is_banned = $1 WHERE id = $2`, [isBanned, tagId]);
  if (!rowCount) throw new AppError(404, "Tag not found");
  await logAdminAction(adminId, isBanned ? "stream_tag.ban" : "stream_tag.unban", "stream_tag", tagId);
}

// Reassigns every stream currently using sourceTagId to targetTagId, then
// removes the now-empty source tag — e.g. merging "gameing" (typo) into
// "gaming" without losing which streams were tagged.
export async function mergeTags(adminId: string, sourceTagId: string, targetTagId: string): Promise<void> {
  if (sourceTagId === targetTagId) throw new AppError(400, "Source and target tags must be different");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT id FROM stream_tags WHERE id = ANY($1)`, [[sourceTagId, targetTagId]]);
    if (rows.length !== 2) throw new AppError(404, "Tag not found");

    await client.query(
      `INSERT INTO stream_tag_links (stream_id, tag_id)
       SELECT stream_id, $2 FROM stream_tag_links WHERE tag_id = $1
       ON CONFLICT DO NOTHING`,
      [sourceTagId, targetTagId]
    );
    await client.query(`DELETE FROM stream_tags WHERE id = $1`, [sourceTagId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await logAdminAction(adminId, "stream_tag.merge", "stream_tag", targetTagId, {
    metadata: { mergedFrom: sourceTagId },
  });
}
