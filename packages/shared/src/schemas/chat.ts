import { z } from "zod";

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
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatTokenSchema = z.object({
  token: z.string(),
});
export type ChatToken = z.infer<typeof chatTokenSchema>;
