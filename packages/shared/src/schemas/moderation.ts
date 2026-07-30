import { z } from "zod";

export const moderationContentTypeSchema = z.enum([
  "stream_title",
  "gift_message",
  "chat_message",
  "stream_thumbnail",
]);

export const moderationFlagSchema = z.object({
  id: z.string().uuid(),
  contentType: moderationContentTypeSchema,
  contentId: z.string().uuid(),
  authorId: z.string().uuid(),
  authorUsername: z.string(),
  textSnapshot: z.string(),
  matchedTerms: z.array(z.string()),
  status: z.enum(["pending", "approved", "removed"]),
  createdAt: z.string(),
});
export type ModerationFlag = z.infer<typeof moderationFlagSchema>;

export const resolveModerationFlagSchema = z.object({
  action: z.enum(["approve", "remove"]),
});
export type ResolveModerationFlagInput = z.infer<typeof resolveModerationFlagSchema>;
