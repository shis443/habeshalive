import { z } from "zod";

// db/migrations/0066_scheduled_streams.sql
export const scheduledStreamStatusSchema = z.enum(["scheduled", "live", "cancelled"]);
export type ScheduledStreamStatus = z.infer<typeof scheduledStreamStatusSchema>;

export const createScheduledStreamSchema = z.object({
  title: z.string().min(1).max(140),
  caption: z.string().max(500).optional(),
  category: z.string().min(1).max(50).optional(),
  language: z.string().min(1).max(30).optional(),
  // ISO datetime string — validated server-side to be in the future, same
  // "trust the client's own clock less than the server's" posture as
  // every other timestamp this codebase accepts as input.
  scheduledAt: z.string(),
  // Same "data: URI or real URL, stored as-is" convention as
  // createStreamSchema's own thumbnailUrl.
  thumbnailUrl: z.string().min(1).max(500_000).optional(),
});
export type CreateScheduledStreamInput = z.infer<typeof createScheduledStreamSchema>;

export const scheduledStreamSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  creatorUsername: z.string(),
  creatorDisplayName: z.string(),
  title: z.string(),
  caption: z.string().nullable(),
  category: z.string().nullable(),
  language: z.string().nullable(),
  scheduledAt: z.string(),
  thumbnailUrl: z.string().nullable(),
  status: scheduledStreamStatusSchema,
  streamId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ScheduledStream = z.infer<typeof scheduledStreamSchema>;
