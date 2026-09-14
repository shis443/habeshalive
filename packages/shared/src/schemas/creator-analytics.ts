import { z } from "zod";

export const creatorAnalyticsWindowSchema = z.enum(["7d", "30d", "90d"]);
export type CreatorAnalyticsWindow = z.infer<typeof creatorAnalyticsWindowSchema>;

// Per-day point. No "unique viewers" or "live views" field — this
// platform stores no per-viewer identity (stream_viewer_samples is a
// periodic aggregate count, not a viewer log, see
// db/migrations/0056_stream_viewer_samples.sql's own GDPR-safe-by-design
// comment), so a real unique-viewer count can't be derived; fabricating
// an estimate would be a made-up number presented as real data, not real
// analytics.
export const creatorAnalyticsDayPointSchema = z.object({
  day: z.string(), // YYYY-MM-DD, Africa/Addis_Ababa calendar day
  peakViewers: z.number().int().nonnegative(),
  avgViewers: z.number().nonnegative(),
  watchHours: z.number().nonnegative(),
  followsGained: z.number().int(),
  // chat_messages is purged after 30 days (chat/service.ts's
  // purgeOldChatMessages) — a 90-day window's older days show 0 here
  // because that history no longer exists, not because chat was quiet.
  chatMessages: z.number().int().nonnegative(),
  revenueSantim: z.number().int().nonnegative(),
});
export type CreatorAnalyticsDayPoint = z.infer<typeof creatorAnalyticsDayPointSchema>;

export const creatorAnalyticsRevenueBreakdownSchema = z.object({
  type: z.string(),
  totalSantim: z.number().int().nonnegative(),
});
export type CreatorAnalyticsRevenueBreakdown = z.infer<typeof creatorAnalyticsRevenueBreakdownSchema>;

export const creatorAnalyticsSchema = z.object({
  window: creatorAnalyticsWindowSchema,
  days: z.array(creatorAnalyticsDayPointSchema),
  revenueByType: z.array(creatorAnalyticsRevenueBreakdownSchema),
  totals: z.object({
    peakViewers: z.number().int().nonnegative(),
    totalWatchHours: z.number().nonnegative(),
    followsGained: z.number().int(),
    totalRevenueSantim: z.number().int().nonnegative(),
  }),
});
export type CreatorAnalytics = z.infer<typeof creatorAnalyticsSchema>;
