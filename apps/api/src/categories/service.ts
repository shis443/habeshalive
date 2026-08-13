import type { ContentCategory, CreateCategoryInput, UpdateCategoryInput } from "@birq/shared";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  artwork_url: string | null;
  tags: string[];
  live_viewer_count: string;
  live_channel_count: string;
  follower_count: string;
}

// Real aggregates only, computed per request — same "never a stale
// denormalized column" posture as follows/category-service.ts's
// getCategoryFollowerCount. peak_viewers is this codebase's established
// "viewer count" column (streams/service.ts's listLiveStreams maps
// viewerCount from it too) — reused here, not a second definition of
// what "viewer count" means.
const CATEGORY_SELECT_SQL = `
  SELECT
    cc.id, cc.slug, cc.name, cc.description, cc.artwork_url,
    COALESCE(
      (SELECT array_agg(ct.tag ORDER BY ct.sort_order) FROM category_tags ct WHERE ct.category_id = cc.id),
      ARRAY[]::varchar[]
    ) AS tags,
    COALESCE(
      (SELECT sum(s.peak_viewers) FROM streams s WHERE s.category = cc.slug AND s.status = 'live'),
      0
    ) AS live_viewer_count,
    COALESCE(
      (SELECT count(*) FROM streams s WHERE s.category = cc.slug AND s.status = 'live'),
      0
    ) AS live_channel_count,
    COALESCE(
      (SELECT count(*) FROM category_follows cf WHERE cf.category = cc.slug),
      0
    ) AS follower_count
  FROM content_categories cc
`;

function toContentCategory(row: CategoryRow): ContentCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    artworkUrl: row.artwork_url,
    tags: row.tags,
    liveViewerCount: Number(row.live_viewer_count),
    liveChannelCount: Number(row.live_channel_count),
    followerCount: Number(row.follower_count),
  };
}

export async function listCategories(): Promise<ContentCategory[]> {
  const { rows } = await pool.query<CategoryRow>(
    `${CATEGORY_SELECT_SQL} WHERE cc.is_active = true ORDER BY cc.sort_order ASC, cc.name ASC`
  );
  return rows.map(toContentCategory);
}

export async function getCategoryBySlug(slug: string): Promise<ContentCategory | null> {
  const { rows } = await pool.query<CategoryRow>(`${CATEGORY_SELECT_SQL} WHERE cc.slug = $1 AND cc.is_active = true`, [
    slug,
  ]);
  return rows[0] ? toContentCategory(rows[0]) : null;
}

// Admin surface — includes inactive categories (an admin toggling
// is_active off needs to still see and re-enable it), same "the manager
// sees everything, the public read only sees what's active" split as
// ads/service.ts's admin vs. public campaign listings.
export async function listCategoriesAdmin(): Promise<ContentCategory[]> {
  const { rows } = await pool.query<CategoryRow>(`${CATEGORY_SELECT_SQL} ORDER BY cc.sort_order ASC, cc.name ASC`);
  return rows.map(toContentCategory);
}

async function replaceCategoryTags(categoryId: string, tags: string[]): Promise<void> {
  await pool.query(`DELETE FROM category_tags WHERE category_id = $1`, [categoryId]);
  if (tags.length === 0) return;
  const values = tags.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(", ");
  const params: unknown[] = [categoryId];
  tags.forEach((tag, i) => params.push(tag, i));
  await pool.query(`INSERT INTO category_tags (category_id, tag, sort_order) VALUES ${values}`, params);
}

export async function createCategory(input: CreateCategoryInput): Promise<ContentCategory> {
  const existing = await pool.query(`SELECT 1 FROM content_categories WHERE slug = $1`, [input.slug]);
  if (existing.rows.length > 0) throw new AppError(409, "A category with this slug already exists");

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO content_categories (slug, name, description, artwork_url, sort_order)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.slug, input.name, input.description ?? null, input.artworkUrl ?? null, input.sortOrder ?? 0]
  );
  const categoryId = rows[0]!.id;
  if (input.tags) await replaceCategoryTags(categoryId, input.tags);

  const created = await pool.query<CategoryRow>(`${CATEGORY_SELECT_SQL} WHERE cc.id = $1`, [categoryId]);
  return toContentCategory(created.rows[0]!);
}

export async function updateCategory(slug: string, input: UpdateCategoryInput): Promise<ContentCategory> {
  const existing = await pool.query<{ id: string }>(`SELECT id FROM content_categories WHERE slug = $1`, [slug]);
  const row = existing.rows[0];
  if (!row) throw new AppError(404, "Category not found");

  await pool.query(
    `UPDATE content_categories SET
       name = COALESCE($2, name),
       description = CASE WHEN $3::boolean THEN $4 ELSE description END,
       artwork_url = CASE WHEN $5::boolean THEN $6 ELSE artwork_url END,
       sort_order = COALESCE($7, sort_order),
       is_active = COALESCE($8, is_active),
       updated_at = now()
     WHERE id = $1`,
    [
      row.id,
      input.name ?? null,
      "description" in input,
      input.description ?? null,
      "artworkUrl" in input,
      input.artworkUrl ?? null,
      input.sortOrder ?? null,
      input.isActive ?? null,
    ]
  );
  if (input.tags) await replaceCategoryTags(row.id, input.tags);

  const updated = await pool.query<CategoryRow>(`${CATEGORY_SELECT_SQL} WHERE cc.id = $1`, [row.id]);
  return toContentCategory(updated.rows[0]!);
}
