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
