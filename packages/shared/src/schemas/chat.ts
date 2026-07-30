import { z } from "zod";
import { gifterBadgeTierSchema } from "./wallet.js";

export const sendChatMessageSchema = z.object({
  body: z.string().min(1).max(500),
});
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  streamId: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  body: z.string(),
  // The sender's Gursha badge tier for THIS stream's creator specifically
  // (gifter_badges is scoped per-creator, see db/migrations/0019_gursha.sql)
  // — "none" means never gifted this creator, not "no badge system exists."
  gifterBadgeTier: gifterBadgeTierSchema,
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatTokenSchema = z.object({
  token: z.string(),
});
export type ChatToken = z.infer<typeof chatTokenSchema>;
