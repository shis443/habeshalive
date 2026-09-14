import { z } from "zod";

// Build 3 — Birq Plus's "global emote slot" perk. See
// db/migrations/0070_emotes.sql for why there's no separate "equipped"
// concept: once approved, an emote is usable by every chatter, and
// created_by + a per-creator slot cap is the whole ownership model.
export const emoteStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type EmoteStatus = z.infer<typeof emoteStatusSchema>;

export const EMOTE_CODE_PATTERN = /^[a-zA-Z0-9_]{2,32}$/;

// Creator-facing — GET /emotes/mine, includes every status so a creator
// can see a submission's rejection reason.
export const emoteSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  imageUrl: z.string(),
  status: emoteStatusSchema,
  rejectionReason: z.string().nullable(),
  createdAt: z.string(),
});
export type Emote = z.infer<typeof emoteSchema>;

// Public catalog (GET /emotes/catalog) — approved-only, no status/
// rejection noise a chat client parsing `:code:` tokens has no use for.
export const catalogEmoteSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  imageUrl: z.string(),
});
export type CatalogEmote = z.infer<typeof catalogEmoteSchema>;

// Admin review queue (GET /admin/emotes) — same shape family as
// kycAdminItemSchema (admin.ts): submitter identity + review queue's
// status/reason fields.
export const emoteAdminItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  imageUrl: z.string(),
  createdByUsername: z.string(),
  status: emoteStatusSchema,
  rejectionReason: z.string().nullable(),
  createdAt: z.string(),
});
export type EmoteAdminItem = z.infer<typeof emoteAdminItemSchema>;

export const rejectEmoteSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectEmoteInput = z.infer<typeof rejectEmoteSchema>;
