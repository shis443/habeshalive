import {
  renderAvatarSvg,
  type AvatarCategory,
  type AvatarManifest,
  type AvatarPart,
  type AvatarSelection,
  type AvatarValues,
} from "@habeshalive/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { deleteObject, getObjectBuffer, isObjectStorageConfigured, uploadObject } from "../common/object-storage.js";
import { flagIfImageMatched } from "../moderation/service.js";

const CATEGORIES: AvatarCategory[] = [
  "background",
  "skin_tone",
  "hair",
  "hair_color",
  "eyes",
  "eyebrows",
  "mouth",
  "facial_hair",
  "accessories",
  "clothing",
  "clothes_color",
];

// Style categories pass their avatar_parts.name (the literal
// @dicebear/avataaars option key) to the renderer; color categories pass
// swatch_color (a hex string). See avatarRender.ts's AvatarValues comment.
const COLOR_CATEGORIES = new Set<AvatarCategory>(["background", "skin_tone", "hair_color", "clothes_color"]);

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
    // Always a real pick, never null — unlike the old flat-swatch model,
    // every category now has only genuine, always-renderable options
    // (a "no facial hair"/"no accessories" choice is itself a real row,
    // avatar_parts.name = 'blank', not a null sentinel — see
    // db/migrations/0029_avataaars_render.sql). A previous version of
    // this function treated `swatchColor === null` as "this pick means
    // unset" — that was specific to the old placeholder's "None" rows and
    // is wrong now that style categories legitimately have a null
    // swatchColor on every real option, which would have made randomize
    // silently pick nothing for hair/eyes/eyebrows/mouth/facialHair/
    // accessories/clothing every time.
    const pick = options[Math.floor(Math.random() * options.length)]!;
    selection[category] = pick.id;
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
  const { rows } = await pool.query<{ category: AvatarCategory; name: string; swatch_color: string | null }>(
    `SELECT s.category, p.name, p.swatch_color
     FROM user_avatar_selections s
     JOIN avatar_parts p ON p.id = s.part_id
     WHERE s.user_id = $1`,
    [userId]
  );

  const values: AvatarValues = {} as AvatarValues;
  for (const category of CATEGORIES) values[category] = null;
  for (const row of rows) {
    values[row.category] = COLOR_CATEGORIES.has(row.category) ? row.swatch_color : row.name;
  }

  return renderAvatarSvg(values);
}

// Module 5 — a real uploaded photo, alongside the generated-parts avatar
// above rather than replacing it. No extension in the object key (unlike
// clips/kyc documents) — S3/R2 stores Content-Type as real object
// metadata independent of the key name, so serving it back just reads
// that metadata rather than needing to reconstruct "was this a .jpg or
// .png" from a stable, opaque avatar_url.
const ALLOWED_PHOTO_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function avatarPhotoKey(userId: string): string {
  return `avatars/${userId}`;
}

export async function uploadAvatarPhoto(
  userId: string,
  buffer: Buffer,
  contentType: string
): Promise<{ avatarUrl: string }> {
  if (!isObjectStorageConfigured) {
    throw new AppError(503, "Photo upload isn't available right now — try again later.");
  }
  if (!ALLOWED_PHOTO_CONTENT_TYPES.has(contentType)) throw new AppError(400, "Upload a JPEG or PNG image.");
  if (buffer.byteLength === 0) throw new AppError(400, "The uploaded file is empty.");
  if (buffer.byteLength > MAX_PHOTO_BYTES) throw new AppError(400, "File is too large (max 5MB).");

  const key = avatarPhotoKey(userId);
  await uploadObject(key, buffer, contentType);

  // Stable, opaque URL — never changes after the first upload, so every
  // other place avatar_url is already embedded (chat messages, stream
  // creator objects, ...) keeps working with zero changes, same as the
  // existing /avatars/render/:userId.svg path.
  const avatarUrl = `/avatars/photo/${userId}`;
  await pool.query(`UPDATE users SET avatar_url = $1 WHERE id = $2`, [avatarUrl, userId]);

  // After-the-fact flag for human review — never blocks the upload
  // itself, same posture as every other moderation check in this
  // codebase (flagIfMatched/flagIfImageMatched's own doc comment).
  await flagIfImageMatched(
    "avatar_photo",
    userId,
    userId,
    `data:${contentType};base64,${buffer.toString("base64")}`
  );

  return { avatarUrl };
}

export async function getAvatarPhoto(userId: string): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const { buffer, contentType } = await getObjectBuffer(avatarPhotoKey(userId));
    return { buffer, contentType: contentType ?? "application/octet-stream" };
  } catch {
    throw new AppError(404, "No uploaded photo for this user");
  }
}

export async function revertToGeneratedAvatar(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET avatar_url = '/avatars/render/' || $1 || '.svg' WHERE id = $1`, [userId]);
  await deleteObject(avatarPhotoKey(userId));
}
