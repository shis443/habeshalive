import {
  renderAvatarSvg,
  type AvatarCategory,
  type AvatarColors,
  type AvatarManifest,
  type AvatarPart,
  type AvatarSelection,
} from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

const CATEGORIES: AvatarCategory[] = ["background", "skin_tone", "hair", "eyes", "accessories"];

interface PartRow {
  id: string;
  category: AvatarCategory;
  name: string;
  swatch_color: string | null;
}

function toAvatarPart(row: PartRow): AvatarPart {
  return { id: row.id, category: row.category, name: row.name, swatchColor: row.swatch_color };
}

export async function listParts(): Promise<AvatarManifest> {
  const { rows } = await pool.query<PartRow>(
    `SELECT id, category, name, swatch_color FROM avatar_parts
     WHERE is_active = TRUE ORDER BY category, sort_order`
  );

  const manifest: AvatarManifest = {};
  for (const category of CATEGORIES) manifest[category] = [];
  for (const row of rows) {
    manifest[row.category]!.push(toAvatarPart(row));
  }
  return manifest;
}

export async function randomizeSelection(): Promise<AvatarSelection> {
  const manifest = await listParts();
  const selection: AvatarSelection = {};
  for (const category of CATEGORIES) {
    const options = manifest[category] ?? [];
    if (options.length === 0) continue;
    const pick = options[Math.floor(Math.random() * options.length)]!;
    selection[category] = pick.swatchColor === null ? null : pick.id;
  }
  return selection;
}

export async function getUserSelection(userId: string): Promise<AvatarSelection> {
  const { rows } = await pool.query<{ category: AvatarCategory; part_id: string }>(
    `SELECT category, part_id FROM user_avatar_selections WHERE user_id = $1`,
    [userId]
  );
  const selection: AvatarSelection = {};
  for (const category of CATEGORIES) selection[category] = null;
  for (const row of rows) selection[row.category] = row.part_id;
  return selection;
}

export async function saveSelection(userId: string, selection: AvatarSelection): Promise<AvatarSelection> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const category of CATEGORIES) {
      const partId = selection[category];
      if (partId === undefined) continue;

      if (partId === null) {
        await client.query(
          `DELETE FROM user_avatar_selections WHERE user_id = $1 AND category = $2`,
          [userId, category]
        );
        continue;
      }

      const partResult = await client.query<{ id: string }>(
        `SELECT id FROM avatar_parts WHERE id = $1 AND category = $2 AND is_active = TRUE`,
        [partId, category]
      );
      if (!partResult.rows[0]) {
        throw new AppError(400, `Invalid part for category ${category}`);
      }

      await client.query(
        `INSERT INTO user_avatar_selections (user_id, category, part_id, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, category)
         DO UPDATE SET part_id = $3, updated_at = now()`,
        [userId, category, partId]
      );
    }

    // Stable per-user URL — the SVG content changes with the stored
    // selection, so this only needs to be set once.
    await client.query(
      `UPDATE users SET avatar_url = COALESCE(avatar_url, '/avatars/render/' || $1 || '.svg') WHERE id = $1`,
      [userId]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getUserSelection(userId);
}

export async function renderUserAvatar(userId: string): Promise<string> {
  const { rows } = await pool.query<{ category: AvatarCategory; swatch_color: string | null }>(
    `SELECT s.category, p.swatch_color
     FROM user_avatar_selections s
     JOIN avatar_parts p ON p.id = s.part_id
     WHERE s.user_id = $1`,
    [userId]
  );

  const colors: AvatarColors = {
    background: null,
    skin_tone: null,
    hair: null,
    eyes: null,
    accessories: null,
  };
  for (const row of rows) colors[row.category] = row.swatch_color;

  return renderAvatarSvg(colors);
}
