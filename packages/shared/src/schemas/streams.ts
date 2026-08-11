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
  // Module 2 — pay-per-view. playbackUrl above is null whenever isPpv is
  // true and hasPpvAccess is false (see streams/service.ts's
  // toStreamDetail), same "gate the field, not a separate endpoint"
  // approach as the rest of this schema.
  isPpv: z.boolean(),
  ppvPriceSantim: z.number().int().positive().nullable(),
  hasPpvAccess: z.boolean(),
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
  // db/migrations/0026_rbac_role_isolation.sql — 'admin' renamed to
  // 'super_admin', 'finance_auditor' added as a new, narrower tier.
  // "admin" stays permanently — see schemas/admin.ts's identical schema
  // for the full reasoning.
  role: z.enum(["viewer", "creator", "moderator", "super_admin", "finance_auditor", "admin"]),
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
  // Module 2 — per-event PPV pricing, a per-broadcast decision (not a
  // standing creator setting) since whether a given stream is ticketed
  // varies event to event. Omitted/absent means a normal, free stream.
  ppvPriceSantim: z.number().int().positive().optional(),
  // Real enforcement, not just a UI nicety — z.literal(true) means the
  // server rejects a go-live request without this, same as any other
  // required field. Recorded as streams.copyright_certified_at, a
  // per-broadcast record (not a one-time account-level setting), since a
  // creator affirms this fresh for each stream, matching how real DMCA
  // certification practice works. No legal claim is made by this field
  // alone — it's the data layer, not a Terms-of-Service statement.
  copyrightCertified: z.literal(true),
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
  description: z.string().nullable(),
  category: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  playbackUrl: z.string(),
  durationSeconds: z.number().int().nullable(),
  views: z.number().int().nonnegative(),
  isPublished: z.boolean(),
  createdAt: z.string(),
});
export type Vod = z.infer<typeof vodSchema>;

// Phase 3.3 — category detail page (app/category/[slug]). vodSchema above
// is creator-scoped (rendered on that creator's own channel page, where
// "whose VOD is this" is already implied by context) and so carries no
// attribution — a cross-creator category feed needs it, same reasoning
// as clips.ts's publicClipSchema.
export const publicVodSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  category: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  playbackUrl: z.string(),
  durationSeconds: z.number().int().nullable(),
  views: z.number().int().nonnegative(),
  createdAt: z.string(),
  creatorUsername: z.string(),
  creatorDisplayName: z.string(),
  creatorAvatarUrl: z.string().nullable(),
});
export type PublicVod = z.infer<typeof publicVodSchema>;

// PATCH /vods/:id/publish body — every field optional since publishing
// with no overrides (just flip is_published) is the common case; only a
// creator explicitly renaming/re-categorizing before publishing sends
// title/description/category. Length caps mirror streams.title's own
// VARCHAR(140)/streams.category's VARCHAR(50) — see db/migrations/0028_
// vod_publish_workflow.sql.
export const publishVodSchema = z.object({
  title: z.string().min(1).max(140).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
});
export type PublishVodInput = z.infer<typeof publishVodSchema>;

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
// .uuid(), not just .min(1) — `stream` is always a userId now (a Postgres
// UUID column), and markLiveByProviderStreamId/markEndedByProviderStreamId
// query creator_profiles by it directly. A non-UUID value used to just miss
// (stream_key was TEXT) and cleanly 404; against a UUID column it's a raw
// Postgres "invalid input syntax for type uuid" error instead — confirmed
// live, a garbage `stream` value 500'd rather than 404'ing. Rejecting it in
// validation instead gives a clean 400.
export const srsCallbackSchema = z.object({
  stream: z.string().uuid(),
  param: z.string().optional(),
});
export type SrsCallback = z.infer<typeof srsCallbackSchema>;

// WHEP (WebRTC-HTTP Egress Protocol) playback broker — apps/api/src/
// streams/whep-routes.ts. Unlike WHIP publish (a browser POSTs its SDP
// offer straight to SRS's public /rtc/v1/whip/, see GoLivePanel.tsx), WHEP
// signaling is brokered: the browser POSTs its offer here (authenticated,
// rate-limited, ban-checked), apps/api relays it to SRS over Fly's private
// network and returns SRS's answer back. This isn't a raw passthrough of
// WHEP's own wire format (Content-Type: application/sdp, a Location
// header) because it travels through apps/web's /api/backend/[...path]
// proxy first, which forces every request/response through JSON (see that
// route's own comment on why) — so the SDP travels as a JSON string field
// in both directions instead of a raw SDP body.
export const whepBrokerRequestSchema = z.object({
  offerSdp: z.string().min(1).max(20_000),
});
export type WhepBrokerRequest = z.infer<typeof whepBrokerRequestSchema>;

// sessionId is an opaque bearer capability the client holds onto (same
// trust model as WHIP's own resource-URL token, or this app's VOD/HLS
// signed URLs — a 122-bit random UUID, unguessable) and echoes back on
// teardown (whepTeardownRequestSchema below). Not identity-based lookup:
// an anonymous viewer's DELETE request has no way to re-prove "I'm the
// same anonymous viewer who POSTed a minute ago" the way an authenticated
// request can via req.user.sub, so the session id itself has to be what
// authorizes teardown.
export const whepBrokerResponseSchema = z.object({
  answerSdp: z.string().min(1),
  sessionId: z.string().uuid(),
});
export type WhepBrokerResponse = z.infer<typeof whepBrokerResponseSchema>;

export const whepTeardownRequestSchema = z.object({
  sessionId: z.string().uuid(),
});
export type WhepTeardownRequest = z.infer<typeof whepTeardownRequestSchema>;

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
