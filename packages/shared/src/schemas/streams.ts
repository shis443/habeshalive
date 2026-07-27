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
  creator: z.object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    bio: z.string().nullable(),
  }),
});
export type LiveStream = z.infer<typeof liveStreamSchema>;

export const streamDetailSchema = liveStreamSchema.extend({
  status: streamStatusSchema,
});
export type StreamDetail = z.infer<typeof streamDetailSchema>;

export const createStreamSchema = z.object({
  title: z.string().min(1).max(140),
  category: z.string().max(50).optional(),
  language: z.string().max(30).optional(),
});
export type CreateStreamInput = z.infer<typeof createStreamSchema>;

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

// SRS's on_publish/on_unpublish HTTP callback body — both hooks send the
// same shape. `stream` is the RTMP stream name, i.e. our stream_key, since
// creators publish to rtmp://host/live/{stream_key}. SRS sends several other
// fields (action, app, vhost, client_id, ip, param, ...) but this is the
// only one our routing logic needs.
export const srsCallbackSchema = z.object({
  stream: z.string().min(1),
});
export type SrsCallback = z.infer<typeof srsCallbackSchema>;
