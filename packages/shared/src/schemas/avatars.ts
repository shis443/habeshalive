import { z } from "zod";

// db/migrations/0029_avataaars_render.sql widened this from the original
// 5-category flat-swatch set to match @dicebear/avataaars's real option
// categories. 'hair'/'eyes'/'accessories' kept their names but changed
// meaning (color -> style key) — see that migration's own comment.
export const avatarCategorySchema = z.enum([
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
]);
export type AvatarCategory = z.infer<typeof avatarCategorySchema>;

export const avatarPartSchema = z.object({
  id: z.string().uuid(),
  category: avatarCategorySchema,
  name: z.string(),
  swatchColor: z.string().nullable(),
});
export type AvatarPart = z.infer<typeof avatarPartSchema>;

export const avatarManifestSchema = z.record(avatarCategorySchema, z.array(avatarPartSchema));
export type AvatarManifest = z.infer<typeof avatarManifestSchema>;

// Selected part id per category — null/absent means "None" for that category.
export const avatarSelectionSchema = z.record(avatarCategorySchema, z.string().uuid().nullable());
export type AvatarSelection = z.infer<typeof avatarSelectionSchema>;

export const saveAvatarSchema = z.object({
  selection: avatarSelectionSchema,
});
export type SaveAvatarInput = z.infer<typeof saveAvatarSchema>;
