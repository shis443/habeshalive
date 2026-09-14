import { z } from "zod";

// db/migrations/0067_creator_tiers.sql
export const creatorTierNameSchema = z.enum(["none", "bronze", "silver", "gold", "partner"]);
export type CreatorTierName = z.infer<typeof creatorTierNameSchema>;

export const creatorTierSchema = z.object({
  tier: creatorTierNameSchema,
  lifetimeWatchHours: z.number().nonnegative(),
  lifetimeGiftVolumeSantim: z.number().int().nonnegative(),
  // Null once a creator has reached the top tier — there's nothing further
  // to progress toward, not a missing value.
  nextTier: creatorTierNameSchema.nullable(),
  nextTierWatchHoursThreshold: z.number().int().nullable(),
  nextTierGiftVolumeSantimThreshold: z.number().int().nullable(),
  // Real perk unlocked by reaching 'partner' — creator_profiles.is_anchor_creator
  // (extended VOD retention today; see creator-tiers-service.ts).
  isAnchorCreator: z.boolean(),
});
export type CreatorTier = z.infer<typeof creatorTierSchema>;
