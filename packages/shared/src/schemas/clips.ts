import { z } from "zod";

// Module 4 — one-click 9:16 clipper (apps/api/src/vods/clip-service.ts),
// a real ffmpeg crop+scale of an existing VOD.
export const MAX_CLIP_DURATION_SECONDS = 60;

export const clipSchema = z.object({
  id: z.string().uuid(),
  vodId: z.string().uuid(),
  title: z.string().nullable(),
  playbackUrl: z.string(),
  startSeconds: z.number().int().nonnegative(),
  durationSeconds: z.number().int().positive(),
  createdAt: z.string(),
});
export type Clip = z.infer<typeof clipSchema>;

export const createClipSchema = z.object({
  startSeconds: z.number().int().nonnegative(),
  durationSeconds: z.number().int().positive().max(MAX_CLIP_DURATION_SECONDS),
  title: z.string().min(1).max(140).optional(),
});
export type CreateClipInput = z.infer<typeof createClipSchema>;

// Phase 3.1 — the public, independently-shareable clip page
// (apps/web/app/clip/[id]) needs more than clipSchema's creator-facing
// shape carries: attribution (a viewer landing from a Telegram/WhatsApp
// share has no other context for whose clip this is), the category the
// source stream was tagged with, and a real view count. Kept as a
// separate type rather than adding these fields to clipSchema — every
// existing clipSchema call site (ClipCreatorPanel, FeaturedClips) is
// creator-scoped, where "whose clip is this" is already implied by the
// page it's rendered on.
export const publicClipSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  playbackUrl: z.string(),
  durationSeconds: z.number().int().positive(),
  createdAt: z.string(),
  views: z.number().int().nonnegative(),
  category: z.string().nullable(),
  creatorUsername: z.string(),
  creatorDisplayName: z.string(),
  creatorAvatarUrl: z.string().nullable(),
});
export type PublicClip = z.infer<typeof publicClipSchema>;
