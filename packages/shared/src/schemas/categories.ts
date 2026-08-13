import { z } from "zod";

// Flutter-reference UI rebuild — real category catalog metadata
// (db/migrations/0046_content_categories.sql). slug matches the existing
// STREAM_CATEGORIES (constants.ts) string values exactly — this table adds
// description/artwork/ordering on top of, not instead of, the flat list
// streams.category/category_follows.category already use.
export const contentCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  // null => the client's generated-art fallback renders instead (see
  // docs/FLUTTER_UI_REBUILD_AUDIT.md's "Category data decision" carried
  // over from the prior audit — no object-storage pipeline exists yet).
  artworkUrl: z.string().nullable(),
  tags: z.array(z.string()),
  // Real aggregates, computed server-side per request — never cached as a
  // stale denormalized column, matching follows/category-service.ts's
  // existing getCategoryFollowerCount pattern.
  liveViewerCount: z.number().int().nonnegative(),
  liveChannelCount: z.number().int().nonnegative(),
  followerCount: z.number().int().nonnegative(),
});
export type ContentCategory = z.infer<typeof contentCategorySchema>;

export const createCategorySchema = z.object({
  slug: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(2000).optional(),
  artworkUrl: z.string().url().optional(),
  sortOrder: z.number().int().optional(),
  tags: z.array(z.string().min(1).max(50)).max(10).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  artworkUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(50)).max(10).optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
