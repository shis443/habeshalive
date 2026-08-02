import { z } from "zod";

export const streamStatusSchema = z.enum(["offline", "live", "ended"]);

export const liveStreamSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  category: z.string().nullable(),
  language: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  playbackUrl: z.string().nullable(),
  startedAt: z.string().nullable(),
  viewerCount: z.number().int().nonnegative(),
  isBoosted: z.boolean(),
  isSensitive: z.boolean(),
  tags: z.array(z.string()),
  creator: z.object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    bio: z.string().nullable(),
    // Admin-set only (see admin/creators-service.ts) — no automated
    // verification criteria exist yet.
    isVerified: z.boolean(),
  }),
});
export type LiveStream = z.infer<typeof liveStreamSchema>;

export const streamDetailSchema = liveStreamSchema.extend({
  status: streamStatusSchema,
});
export type StreamDetail = z.infer<typeof streamDetailSchema>;

// D.1: individual viewer currently connected to the stream's chat channel,
// resolved from Centrifugo's presence API (see streams/service.ts's
// getViewerList) — anonymous connections (no logged-in userId) are
// summarized as a count, not listed individually, since there's no
// profile to show.
export const viewerListEntrySchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(["viewer", "creator", "moderator", "admin"]),
  gifterBadgeTier: z.enum(["none", "bronze", "silver", "gold", "platinum"]),
});
export type ViewerListEntry = z.infer<typeof viewerListEntrySchema>;

export const viewerListSchema = z.object({
  viewers: z.array(viewerListEntrySchema),
  anonymousCount: z.number().int().nonnegative(),
});
export type ViewerList = z.infer<typeof viewerListSchema>;

export const createStreamSchema = z.object({
  title: z.string().min(1).max(140),
  category: z.string().min(1).max(50),
  language: z.string().min(1).max(30),
  // Accepts either a real URL (once object storage is wired, see Section 4)
  // or a client-compressed data: URI — 500_000 chars is comfortably above a
  // 640x360 JPEG at quality 0.7 (typically 20-60KB / ~30-80k base64 chars).
  thumbnailUrl: z.string().min(1).max(500_000).optional(),
  isSensitive: z.boolean().optional(),
  // "A small set per stream," per the spec — capped at 5, not left open.
  tags: z.array(z.string().min(1).max(30)).max(5).optional(),
});
export type CreateStreamInput = z.infer<typeof createStreamSchema>;

// What the go-live setup form pre-fills from — a creator's last-used
// category/language (persisted on creator_profiles, since those rarely
// change stream to stream), not title/thumbnail (which usually do, so
// those start blank each time rather than carrying over stale content).
export const streamDefaultsSchema = z.object({
  category: z.string().nullable(),
  language: z.string().nullable(),
});
export type StreamDefaults = z.infer<typeof streamDefaultsSchema>;

export const streamKeySchema = z.object({
  rtmpUrl: z.string(),
  streamKey: z.string(),
});
export type StreamKeyResponse = z.infer<typeof streamKeySchema>;

export const boostStreamResponseSchema = z.object({
  id: z.string().uuid(),
  endsAt: z.string(),
});
export type BoostStreamResponse = z.infer<typeof boostStreamResponseSchema>;

export const activeBoostSchema = z.object({
  id: z.string().uuid(),
  creatorId: z.string().uuid(),
  creatorUsername: z.string(),
  priceSantim: z.number().int(),
  startsAt: z.string(),
  endsAt: z.string(),
});
export type ActiveBoost = z.infer<typeof activeBoostSchema>;

export const creatorStatsSchema = z.object({
  followerCount: z.number().int().nonnegative(),
  streamHoursTotal: z.number().nonnegative(),
});
export type CreatorStats = z.infer<typeof creatorStatsSchema>;

export const vodSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  playbackUrl: z.string(),
  durationSeconds: z.number().int().nullable(),
  createdAt: z.string(),
});
export type Vod = z.infer<typeof vodSchema>;

// SRS's on_publish/on_unpublish HTTP callback body — both hooks send the
// same shape. `stream` is the RTMP stream name. As of the stream-key
// exposure fix, that's the creator's own user id (safe to expose — it's
// already public everywhere), NOT the secret publish credential: creators
// publish to rtmp://host/live/{userId}?key={stream_key}, and `param` is
// where SRS forwards that query string (e.g. "?key=abc123"). The old shape
// (`stream` = the raw stream_key) embedded the publish secret directly in
// the public playback URL, since SRS's HLS output path mirrors whatever
// name was used to publish — see streams/service.ts's markLiveByProviderStreamId
// for where `param` gets parsed and validated against the real secret.
export const srsCallbackSchema = z.object({
  stream: z.string().min(1),
  param: z.string().optional(),
});
export type SrsCallback = z.infer<typeof srsCallbackSchema>;

// SRS's on_dvr callback — fires when a recorded segment finishes writing.
// Not wired up on the SRS side yet (no dvr{} block/on_dvr hook in
// infra/srs/conf/srs.conf.template), so this route exists but has never
// received a real callback — see streams/routes.ts's comment on the route
// that uses this schema.
export const srsDvrCallbackSchema = z.object({
  stream: z.string().min(1),
  file: z.string().min(1),
});
export type SrsDvrCallback = z.infer<typeof srsDvrCallbackSchema>;
