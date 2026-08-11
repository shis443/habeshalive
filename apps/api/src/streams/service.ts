import {
  renderThumbnailPlaceholderSvg,
  type AspectRatio,
  type BoostStreamResponse,
  type CreateStreamInput,
  type CreatorStats,
  type StreamActivity,
  type StreamArchiveItem,
  type StreamDefaults,
  type StreamDetail,
  type StreamKeyResponse,
  type ViewerList,
  type ViewerListEntry,
} from "@birq/shared";
import { logAdminAction } from "../admin/audit.js";
import { getBoostPricing, getDefaultRevenueShareBps } from "../admin/config-service.js";
import { pool } from "../common/db.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import { AppError } from "../common/errors.js";
import { env } from "../common/env.js";
import { encryptSecret, resolveStreamKey, timingSafeEqualStreamKey } from "../common/crypto.js";
import { flagIfImageMatched, flagIfMatched } from "../moderation/service.js";
import { killActiveRtmpPublishers } from "../moderation/actions-service.js";
import { isApprovedCreator } from "../creator-applications/service.js";
import { notifyFollowersCategoryLive, notifyFollowersCreatorLive } from "../notifications/service.js";
import { appendHlsToken } from "./hls-token.js";
import { hasPpvAccess } from "./ppv-service.js";
import { linkTagsToStream } from "./tags-service.js";
import { sendGoLiveAnnouncement } from "./telegram-client.js";
import { videoProvider } from "./video-provider.js";

export function thumbnailPlaceholderSvg(category: string): string {
  return renderThumbnailPlaceholderSvg(category);
}

function thumbnailPlaceholderUrl(category: string): string {
  return `${env.API_PUBLIC_URL}/streams/thumbnail-placeholder/${encodeURIComponent(category)}.svg`;
}

// Fire-and-forget-ish, but still awaited: a stream_events write failing
// shouldn't be possible to notice from the caller's perspective (this is
// pure groundwork logging, see db/migrations/0011 — no feature reads it
// yet), so errors are swallowed here rather than propagated into goLive()/
// endStream()'s own error handling.
async function logStreamEvent(streamId: string, type: "started" | "ended"): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO stream_events (stream_id, type, category, peak_viewers)
       SELECT id, $2, category, peak_viewers FROM streams WHERE id = $1`,
      [streamId, type]
    );
  } catch (err) {
    console.error(`[stream_events] failed logging ${type} for ${streamId}:`, err);
  }
}

interface CreatorProfileRow {
  user_id: string;
  stream_key: string;
}

interface StreamRow {
  id: string;
  title: string;
  category: string | null;
  language: string | null;
  thumbnail_url: string | null;
  playback_url: string | null;
  started_at: string | null;
  status: string;
  creator_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
  peak_viewers: number;
  is_boosted: boolean;
  is_sensitive: boolean;
  tags: string[];
  is_ppv: boolean;
  ppv_price_santim: number | null;
  aspect_ratio: AspectRatio;
}

// Module 2 — the creator always has access to their own stream; anyone
// else needs a completed ppv_purchases row. A non-PPV stream trivially
// has "access" for everyone, same as before this module existed.
async function resolvePpvAccess(row: StreamRow, viewerId: string | undefined): Promise<boolean> {
  if (!row.is_ppv) return true;
  if (viewerId && viewerId === row.creator_id) return true;
  return hasPpvAccess(row.id, viewerId);
}

// hasAccess gates playbackUrl only — every other field (title, thumbnail,
// price) stays visible so a non-purchaser still sees enough to decide
// whether to buy a ticket, same "show metadata, gate the stream itself"
// posture as an offline stream's playbackUrl already being null.
function toStreamDetail(row: StreamRow, hasAccess: boolean): StreamDetail {
  const playbackUrl =
    row.playback_url && hasAccess ? appendHlsToken(row.playback_url, row.creator_id) : null;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    language: row.language,
    thumbnailUrl: row.thumbnail_url,
    // Signed fresh on every read, not baked into the stored playback_url
    // column at go-live time — a stream can stay live for hours (up to
    // the 12h reaper backstop), so a token generated once at go-live
    // would expire while the stream is still live. Same reasoning as
    // vods/service.ts's getSignedVodUrl being called at read time, not
    // write time. No-op until HLS_TOKEN_HMAC_SECRET is configured.
    playbackUrl,
    startedAt: row.started_at,
    aspectRatio: row.aspect_ratio,
    status: row.status as StreamDetail["status"],
    viewerCount: row.peak_viewers,
    isBoosted: row.is_boosted,
    isSensitive: row.is_sensitive,
    tags: row.tags,
    isPpv: row.is_ppv,
    ppvPriceSantim: row.ppv_price_santim,
    hasPpvAccess: hasAccess,
    creator: {
      id: row.creator_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      isVerified: row.is_verified,
    },
  };
}

// Shared by every function that returns a StreamDetail (listLiveStreams,
// listAllLiveStreamsForAdmin, getStreamById, getLiveStreamByUsername) —
// adding tags here once flows through all of them, rather than touching
// four separate queries.
const STREAM_SELECT_COLUMNS = `
  s.id, s.title, s.category, s.language, s.thumbnail_url, s.playback_url,
  s.started_at, s.status, s.peak_viewers, s.is_sensitive, s.is_ppv, s.ppv_price_santim, s.aspect_ratio,
  u.id AS creator_id, u.username, u.display_name, u.avatar_url, u.bio, u.is_verified,
  EXISTS (
    SELECT 1 FROM stream_boosts b WHERE b.creator_id = s.creator_id AND b.ends_at > now()
  ) AS is_boosted,
  COALESCE(
    (SELECT array_agg(st.name ORDER BY st.name) FROM stream_tag_links stl
     JOIN stream_tags st ON st.id = stl.tag_id WHERE stl.stream_id = s.id),
    ARRAY[]::text[]
  ) AS tags
`;

async function ensureCreatorProfile(userId: string): Promise<CreatorProfileRow> {
  const existing = await pool.query<CreatorProfileRow>(
    `SELECT user_id, stream_key FROM creator_profiles WHERE user_id = $1`,
    [userId]
  );
  if (existing.rows[0]) return existing.rows[0];

  // A.4 launch gate: streaming access is capped to an approved batch of
  // creators while the platform is new. Only checked here, on the path
  // that creates a NEW creator profile — anyone who already has one
  // (existing creators, grandfathered by db/migrations/0018) never hits
  // this at all, so this can't lock out someone who already had access.
  if (!(await isApprovedCreator(userId))) {
    throw new AppError(403, "Streaming on Birq currently requires an approved creator application.");
  }

  const { streamKey } = await videoProvider.createLiveInput();
  const defaultRevenueShareBps = await getDefaultRevenueShareBps();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Encrypted at rest (AES-256-GCM, common/crypto.ts) from creation —
    // only ever-generated keys land here, never a legacy plaintext row
    // (those all predate this pass; see resolveStreamKey's own comment
    // for how reads stay dual-compat with them).
    const inserted = await client.query<CreatorProfileRow>(
      `INSERT INTO creator_profiles (user_id, stream_key, revenue_share_bps) VALUES ($1, $2, $3)
       RETURNING user_id, stream_key`,
      [userId, encryptSecret(streamKey), defaultRevenueShareBps]
    );
    await client.query(`UPDATE users SET role = 'creator' WHERE id = $1 AND role = 'viewer'`, [
      userId,
    ]);
    await client.query("COMMIT");
    return inserted.rows[0]!;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// The "Stream Key" field value a creator pastes into OBS is a composed
// `{userId}?key={secret}` string, not the bare secret — see the stream-key
// exposure fix note on srsCallbackSchema. userId is the RTMP "stream name"
// (and therefore also the HLS playback path SRS serves it at), the actual
// `?key=` part travels as an RTMP query param SRS forwards to on_publish as
// `param`. GoLivePanel's buildWhipUrl and StreamKeyRow both consume this
// same composed string unchanged, splitting it apart only where needed.
function composeStreamKeyField(userId: string, secret: string): string {
  return `${userId}?key=${secret}`;
}

export async function getStreamKey(userId: string): Promise<StreamKeyResponse> {
  const profile = await ensureCreatorProfile(userId);
  return {
    rtmpUrl: videoProvider.getRtmpUrl(),
    streamKey: composeStreamKeyField(userId, resolveStreamKey(profile.stream_key)),
  };
}

// "Instant" is real, not just a fresh key in the DB: whatever's currently
// publishing under the old key gets force-disconnected too, same
// mechanism (and same fail-open reasoning — see
// moderation/actions-service.ts's killActiveRtmpPublishers) as a ban's
// RTMP teardown. Without this, a leaked key stayed live until the
// encoder's *next* natural disconnect — rotating it didn't actually stop
// an attacker already broadcasting with the old one.
export async function rotateStreamKey(userId: string): Promise<StreamKeyResponse> {
  await ensureCreatorProfile(userId);
  const { streamKey } = await videoProvider.createLiveInput();
  await pool.query(`UPDATE creator_profiles SET stream_key = $1, updated_at = now() WHERE user_id = $2`, [
    encryptSecret(streamKey),
    userId,
  ]);
  killActiveRtmpPublishers(userId).catch((err) => {
    console.error(`[streams] failed to kill active publisher after key rotation for ${userId}:`, err);
  });
  return { rtmpUrl: videoProvider.getRtmpUrl(), streamKey: composeStreamKeyField(userId, streamKey) };
}

// category/language matched case-insensitively — stream.category and
// .language are free-form text (no enum/CHECK constraint), so an
// exact-case match would silently miss real streams over a casing
// difference alone. tag is normalized lowercase already (see
// tags-service.ts), matched exactly against the same normalized form.
// viewerId gates labeled (is_sensitive) streams to viewers whose own
// account preference opts in — see db/migrations/0012. NULL (anonymous or
// not opted in) never matches the EXISTS, so those streams are simply
// absent from the list rather than shown-but-blurred.
// Birq Rank Score — the homepage default. (Viewers x1) + (Birr gifted x2)
// + (new subscribers acquired during this stream x50). Adapted from the
// original 4-term spec (Viewers, Santim gifted, Amole gifted, Gifted
// subs): this platform's real currency is Birr/Santim only (no separate
// Amole denomination — see money.ts), so the two gift terms collapse
// into one, weighted in Birr (santim/100) rather than raw santim so a
// single Kurt gift (1,000 ETB = 100,000 santim) scores comparably to a
// few thousand viewers, not literally 200,000 points. "Gifted subs" has
// no equivalent feature here (subscriptions.ts has no gift-a-sub path —
// confirmed against the schema), so this substitutes new subscriptions
// to the creator started during the stream's live window: a real,
// stream-attributable monetization signal, same scoping as viewers/
// gifts, rather than inventing a feature that doesn't exist to satisfy
// the original wording literally.
const BIRQ_RANK_SCORE_EXPR = `(
  COALESCE(s.peak_viewers, 0)
  + COALESCE((
      SELECT SUM(gt.price_santim * gs.quantity)
      FROM gifts_sent gs JOIN gift_types gt ON gt.id = gs.gift_type_id
      WHERE gs.stream_id = s.id
    ), 0) / 100.0 * 2
  + COALESCE((
      SELECT SUM(d.amount_santim) FROM donations d WHERE d.stream_id = s.id
    ), 0) / 100.0 * 2
  + (
      SELECT COUNT(*) FROM subscriptions sub
      WHERE sub.creator_id = s.creator_id AND sub.started_at >= s.started_at
    ) * 50
)`;

const SORT_CLAUSES = {
  birqRank: `${BIRQ_RANK_SCORE_EXPR} DESC NULLS LAST, s.started_at DESC`,
  viewers: "s.peak_viewers DESC NULLS LAST, s.started_at DESC",
  recent: "s.started_at DESC",
  alphabetical: "s.title ASC",
} as const;
export type LiveStreamSort = keyof typeof SORT_CLAUSES;

export async function listLiveStreams(filters: {
  category?: string;
  language?: string;
  tag?: string;
  viewerId?: string;
  sort?: LiveStreamSort;
} = {}): Promise<StreamDetail[]> {
  const sortClause = SORT_CLAUSES[filters.sort ?? "birqRank"];
  const { rows } = await pool.query<StreamRow>(
    `SELECT ${STREAM_SELECT_COLUMNS}
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE s.status = 'live'
       AND ($1::text IS NULL OR lower(s.category) = lower($1))
       AND ($2::text IS NULL OR lower(s.language) = lower($2))
       AND ($3::text IS NULL OR EXISTS (
         SELECT 1 FROM stream_tag_links stl JOIN stream_tags st ON st.id = stl.tag_id
         WHERE stl.stream_id = s.id AND st.name = lower($3)
       ))
       AND (s.is_sensitive = FALSE OR EXISTS (
         SELECT 1 FROM users v WHERE v.id = $4 AND v.show_sensitive_content = TRUE
       ))
     ORDER BY is_boosted DESC, ${sortClause}`,
    [filters.category ?? null, filters.language ?? null, filters.tag ?? null, filters.viewerId ?? null]
  );
  // The browse grid never renders playbackUrl (only VideoPlayer/embed do —
  // see apps/web/components/VideoPlayer.tsx), so there's no real access
  // check to run per-card here; passing !row.is_ppv just means a PPV
  // card's (unused) playbackUrl field comes back null rather than a live
  // URL, which is the safe default regardless.
  return rows.map((row) => toStreamDetail(row, !row.is_ppv));
}

// Admin operational view — every live stream regardless of category or
// is_sensitive, unlike listLiveStreams() above which is what viewers
// browse and is gated by their own content preference. Internal ops needs
// to see everything.
export async function listAllLiveStreamsForAdmin(): Promise<StreamDetail[]> {
  const { rows } = await pool.query<StreamRow>(
    `SELECT ${STREAM_SELECT_COLUMNS}
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE s.status = 'live'
     ORDER BY s.started_at DESC`
  );
  // Admin ops view — always the real playbackUrl, PPV or not; moderation
  // needs to see what's actually airing regardless of who's paid for it.
  return rows.map((row) => toStreamDetail(row, true));
}

export async function getStreamById(streamId: string, viewerId?: string): Promise<StreamDetail> {
  const { rows } = await pool.query<StreamRow>(
    `SELECT ${STREAM_SELECT_COLUMNS}
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE s.id = $1`,
    [streamId]
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "Stream not found");
  return toStreamDetail(row, await resolvePpvAccess(row, viewerId));
}

export async function getLiveStreamByUsername(username: string, viewerId?: string): Promise<StreamDetail> {
  const { rows } = await pool.query<StreamRow>(
    `SELECT ${STREAM_SELECT_COLUMNS}
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE u.username = $1 AND s.status = 'live'
       AND (s.is_sensitive = FALSE OR EXISTS (
         SELECT 1 FROM users v WHERE v.id = $2 AND v.show_sensitive_content = TRUE
       ))
     ORDER BY s.started_at DESC LIMIT 1`,
    [username, viewerId ?? null]
  );
  const row = rows[0];
  // Same 404 whether the creator is genuinely offline or is live but
  // streaming labeled content this viewer hasn't opted into — not
  // revealing "there's something here, you just can't see it" is the
  // safer behavior for a content-sensitivity gate.
  if (!row) throw new AppError(404, "This creator is not live right now");
  return toStreamDetail(row, await resolvePpvAccess(row, viewerId));
}

// Module 3 — squad-service.ts's per-member grid lookup. Unlike
// getLiveStreamByUsername above, "not currently live" is an expected,
// normal state for a squad member (their tile just renders offline),
// not a 404 — and there's deliberately no is_sensitive gate here: a
// squad's own member list already comes from an authenticated context
// (streams/routes.ts's squad routes), not an anonymous content-browse
// surface.
export async function getLiveStreamByCreatorId(creatorId: string, viewerId?: string): Promise<StreamDetail | null> {
  const { rows } = await pool.query<StreamRow>(
    `SELECT ${STREAM_SELECT_COLUMNS}
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     WHERE s.creator_id = $1 AND s.status = 'live'
     ORDER BY s.started_at DESC LIMIT 1`,
    [creatorId]
  );
  const row = rows[0];
  if (!row) return null;
  return toStreamDetail(row, await resolvePpvAccess(row, viewerId));
}

export async function getStreamActivity(streamId: string): Promise<StreamActivity> {
  const streamResult = await pool.query<{ creator_id: string; started_at: string | null }>(
    `SELECT creator_id, started_at FROM streams WHERE id = $1`,
    [streamId]
  );
  const stream = streamResult.rows[0];
  if (!stream) throw new AppError(404, "Stream not found");

  const giftsResult = await pool.query<{ count: number }>(
    `SELECT count(*) FROM gifts_sent WHERE stream_id = $1`,
    [streamId]
  );

  const subsResult = await pool.query<{ count: number }>(
    `SELECT count(*) FROM subscriptions WHERE creator_id = $1 AND status = 'active'`,
    [stream.creator_id]
  );

  const eventsResult = await pool.query<{
    id: string;
    type: "gift" | "subscription";
    username: string;
    label: string;
  }>(
    `(SELECT gs.id, 'gift' AS type, u.display_name AS username, gt.name || ' x' || gs.quantity AS label, gs.created_at
      FROM gifts_sent gs
      JOIN users u ON u.id = gs.sender_id
      JOIN gift_types gt ON gt.id = gs.gift_type_id
      WHERE gs.stream_id = $1)
     UNION ALL
     (SELECT sub.id, 'subscription' AS type, u.display_name AS username, st.name AS label, sub.created_at
      FROM subscriptions sub
      JOIN users u ON u.id = sub.subscriber_id
      JOIN subscription_tiers st ON st.id = sub.tier_id
      WHERE sub.creator_id = $2 AND sub.created_at >= COALESCE($3, sub.created_at))
     ORDER BY created_at DESC
     LIMIT 5`,
    [streamId, stream.creator_id, stream.started_at]
  );

  return {
    giftsCount: giftsResult.rows[0]?.count ?? 0,
    activeSubscribers: subsResult.rows[0]?.count ?? 0,
    recentEvents: eventsResult.rows.map((row) => ({
      id: row.id,
      type: row.type,
      username: row.username,
      label: row.label,
    })),
  };
}

// D.1 viewer list: Centrifugo's presence API for the stream-chat channel
// (presence: true in infra/centrifugo/config.json's "stream-chat"
// namespace — already enabled, just never queried until now). "sub" on
// each connection token is either a real userId or an "anon-<hex>"
// placeholder (see chat/token.ts) — anonymous connections are summarized
// as a count only, since there's no profile to show for them.
interface CentrifugoPresenceResult {
  result?: { presence?: Record<string, { user: string }> };
}

export async function getViewerList(streamId: string): Promise<ViewerList> {
  let data: CentrifugoPresenceResult;
  try {
    const res = await fetch(`${env.CENTRIFUGO_URL}/api`, {
      method: "POST",
      headers: { "X-API-Key": env.CENTRIFUGO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ method: "presence", params: { channel: `stream-chat:${streamId}` } }),
    });
    if (!res.ok) {
      // Presence is a nice-to-have overlay, not core chat delivery — degrade
      // to an empty list rather than break the watch page over it.
      console.error(`[viewer-list] Centrifugo presence failed: ${res.status}`);
      return { viewers: [], anonymousCount: 0 };
    }
    data = (await res.json()) as CentrifugoPresenceResult;
  } catch (err) {
    // Same degrade-not-break intent as the !res.ok branch above, but for a
    // network-level failure (Centrifugo unreachable), which a bare fetch()
    // throws before there's even a response to check — the comment above
    // didn't actually cover this failure mode until this fix.
    console.error(`[viewer-list] Centrifugo presence request failed:`, err);
    return { viewers: [], anonymousCount: 0 };
  }
  const clients = Object.values(data.result?.presence ?? {});

  const userIds = new Set<string>();
  let anonymousCount = 0;
  for (const client of clients) {
    if (client.user && !client.user.startsWith("anon-")) userIds.add(client.user);
    else anonymousCount += 1;
  }
  if (userIds.size === 0) return { viewers: [], anonymousCount };

  const stream = await pool.query<{ creator_id: string }>(`SELECT creator_id FROM streams WHERE id = $1`, [
    streamId,
  ]);
  const creatorId = stream.rows[0]?.creator_id;

  const { rows } = await pool.query<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    role: string;
    gifter_badge_tier: string | null;
  }>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.role,
            gb.tier AS gifter_badge_tier
     FROM users u
     LEFT JOIN gifter_badges gb ON gb.user_id = u.id AND gb.creator_id = $2
     WHERE u.id = ANY($1::uuid[])
     ORDER BY u.display_name`,
    [Array.from(userIds), creatorId ?? null]
  );

  return {
    viewers: rows.map((row) => ({
      userId: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      role: row.role as ViewerListEntry["role"],
      gifterBadgeTier: (row.gifter_badge_tier ?? "none") as ViewerListEntry["gifterBadgeTier"],
    })),
    anonymousCount,
  };
}

export async function getCreatorStats(userId: string): Promise<CreatorStats> {
  const followerResult = await pool.query<{ count: number }>(
    `SELECT count(*) FROM follows WHERE creator_id = $1`,
    [userId]
  );
  const hoursResult = await pool.query<{ hours: number | null }>(
    `SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))) / 3600 AS hours
     FROM streams WHERE creator_id = $1 AND started_at IS NOT NULL`,
    [userId]
  );
  return {
    followerCount: followerResult.rows[0]?.count ?? 0,
    streamHoursTotal: Math.round((hoursResult.rows[0]?.hours ?? 0) * 10) / 10,
  };
}

export async function getStreamDefaults(userId: string): Promise<StreamDefaults> {
  const { rows } = await pool.query<{ category: string | null; language: string | null }>(
    `SELECT category, language FROM creator_profiles WHERE user_id = $1`,
    [userId]
  );
  return { category: rows[0]?.category ?? null, language: rows[0]?.language ?? null };
}

export async function goLive(userId: string, input: CreateStreamInput): Promise<StreamDetail> {
  const { rows: userRows } = await pool.query<{ is_suspended: boolean }>(
    `SELECT is_suspended FROM users WHERE id = $1`,
    [userId]
  );
  if (userRows[0]?.is_suspended) throw new AppError(403, "Your streaming privileges are currently suspended");

  // Return value unused here — goLive no longer needs the raw stream_key
  // (playback_url is now keyed by userId, not the secret), just the
  // side effect of ensuring a profile/approval exists.
  await ensureCreatorProfile(userId);

  await pool.query(
    `UPDATE streams SET status = 'ended', ended_at = now()
     WHERE creator_id = $1 AND status IN ('offline', 'live')`,
    [userId]
  );

  // Category/language rarely change stream to stream (unlike title/
  // thumbnail) — persisting them here is what lets the next go-live setup
  // form pre-fill instead of starting blank every time.
  await pool.query(`UPDATE creator_profiles SET category = $1, language = $2, updated_at = now() WHERE user_id = $3`, [
    input.category,
    input.language,
    userId,
  ]);

  // Keyed by userId, not profile.stream_key — see composeStreamKeyField's
  // comment. The playback URL (and provider_stream_id, used to match
  // incoming SRS webhooks) must never contain the actual publish secret.
  const playbackUrl = videoProvider.getPlaybackUrl(userId);
  const thumbnailUrl = input.thumbnailUrl ?? thumbnailPlaceholderUrl(input.category);
  // Reported by the app's own encoder config (resolution.dimensions(portrait:)
  // on the Swift side) — real numbers the server buckets itself, not a
  // pre-labeled ratio string. SRS's on_publish callback can't supply this:
  // it fires at the moment publishing begins, before any video is decoded,
  // so {stream, param} is genuinely all it carries (see srsCallbackSchema).
  // Falls back to the streams.aspect_ratio column's own '16:9' default for
  // pre-update app builds that don't send these fields yet.
  const aspectRatio: AspectRatio | undefined =
    input.videoWidth && input.videoHeight
      ? input.videoHeight > input.videoWidth
        ? "9:16"
        : "16:9"
      : undefined;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, category, language, thumbnail_url, playback_url, provider_stream_id, status, started_at, is_sensitive, is_ppv, ppv_price_santim, copyright_certified_at, aspect_ratio)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'live', now(), $8, $9, $10, now(), $11)
     RETURNING id`,
    [
      userId,
      input.title,
      input.category,
      input.language,
      thumbnailUrl,
      playbackUrl,
      userId,
      input.isSensitive ?? false,
      Boolean(input.ppvPriceSantim),
      input.ppvPriceSantim ?? null,
      aspectRatio ?? "16:9",
    ]
  );
  const streamId = rows[0]!.id;

  await flagIfMatched("stream_title", streamId, userId, input.title);
  // Only real user uploads need moderating — thumbnailPlaceholderUrl()'s
  // auto-generated SVGs above are server-rendered from a fixed category
  // list, not user content.
  if (input.thumbnailUrl) {
    await flagIfImageMatched("stream_thumbnail", streamId, userId, input.thumbnailUrl);
  }
  if (input.tags && input.tags.length > 0) {
    await linkTagsToStream(pool, streamId, input.tags);
  }
  await logStreamEvent(streamId, "started");

  const stream = await getStreamById(streamId, userId);
  // Detached (no await) — see notifyFollowersCreatorLive's own comment on
  // why a slow/large follower fan-out shouldn't delay this response.
  notifyFollowersCreatorLive(userId, stream.creator.username, stream.creator.displayName).catch((err) => {
    console.error("[streams] notifyFollowersCreatorLive failed:", err);
  });
  // Phase 3.4 — same detached, best-effort posture as the creator-follow
  // notification above.
  notifyFollowersCategoryLive(input.category, userId, stream.creator.username, stream.creator.displayName).catch(
    (err) => {
      console.error("[streams] notifyFollowersCategoryLive failed:", err);
    }
  );
  // Module 4 — no-ops until TELEGRAM_BOT_TOKEN/TELEGRAM_CHANNEL_ID are
  // configured (see telegram-client.ts).
  sendGoLiveAnnouncement(stream.creator.displayName, `${env.WEB_PUBLIC_URL}/watch/${stream.creator.username}`).catch(
    (err) => {
      console.error("[streams] sendGoLiveAnnouncement failed:", err);
    }
  );
  return stream;
}

export async function endStream(userId: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE streams SET status = 'ended', ended_at = now()
     WHERE creator_id = $1 AND status = 'live'
     RETURNING id`,
    [userId]
  );
  if (!rows[0]) throw new AppError(404, "No live stream to end");
  await logStreamEvent(rows[0].id, "ended");
  // Rotate the RTMP key on every stream end, not just on-demand
  // (rotateStreamKey's own manual-rotation call site above still exists for
  // "I think my key leaked, right now"). A stream key was otherwise valid
  // indefinitely — anyone who'd captured it (a scraped OBS profile export,
  // a compromised device, a support screenshot) could publish as this
  // creator at literally any future time, not just during the stream where
  // it leaked. This closes that window down to "only during a live
  // broadcast." Best-effort: a rotation failure here shouldn't turn a
  // successful stream-end into a user-facing error — the stream is already
  // correctly marked ended either way, and rotateStreamKey remains
  // available on demand if this silently failed.
  try {
    await rotateStreamKey(userId);
  } catch (err) {
    console.error(`[streams] auto-rotate on end failed for ${userId}:`, err);
  }
}

// The heavier, rarer emergency shutdown — unlike endStream() above (a
// creator ending their own stream) or the reaper (a dead-connection
// cleanup), this is an admin cutting off a stream that's still actually
// broadcasting, for something that can't wait for the moderation queue.
// Logged to admin_actions with a required reason, same as every other
// admin mutation.
export async function forceEndStream(streamId: string, adminId: string, reason: string): Promise<void> {
  const { rows } = await pool.query<{ id: string; creator_id: string; title: string }>(
    `UPDATE streams SET status = 'ended', ended_at = now()
     WHERE id = $1 AND status = 'live'
     RETURNING id, creator_id, title`,
    [streamId]
  );
  const stream = rows[0];
  if (!stream) throw new AppError(404, "Stream not found or already ended");
  await logStreamEvent(stream.id, "ended");
  await logAdminAction(adminId, "stream.force_end", "stream", stream.id, {
    reason,
    metadata: { creatorId: stream.creator_id, title: stream.title },
  });
}

interface StreamArchiveRow {
  id: string;
  title: string;
  category: string | null;
  creator_username: string;
  peak_viewers: number;
  started_at: string | null;
  ended_at: string | null;
  vod_id: string | null;
}

// Past streams for support/dispute lookups — not paginated beyond a hard
// limit since this is an internal tool, not a public-scale listing.
export async function listStreamArchive(filters: { creatorUsername?: string; limit?: number }): Promise<
  StreamArchiveItem[]
> {
  const { rows } = await pool.query<StreamArchiveRow>(
    `SELECT s.id, s.title, s.category, u.username AS creator_username, s.peak_viewers,
            s.started_at, s.ended_at, v.id AS vod_id
     FROM streams s
     JOIN users u ON u.id = s.creator_id
     LEFT JOIN stream_vods v ON v.stream_id = s.id
     WHERE s.status = 'ended'
       AND ($1::text IS NULL OR u.username ILIKE '%' || $1 || '%')
     ORDER BY s.ended_at DESC NULLS LAST
     LIMIT $2`,
    [filters.creatorUsername ?? null, filters.limit ?? 100]
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    creatorUsername: row.creator_username,
    peakViewers: row.peak_viewers,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    vodId: row.vod_id,
  }));
}

// 100% to platform, no creator/platform split — unlike gifts/subs, the
// creator here is the buyer, not someone being paid, so there's no revenue
// to share with themselves. Reuses ledger_transactions the same way, just
// with a single debit-only leg from the creator's own wallet.
export async function boostStream(creatorId: string): Promise<BoostStreamResponse> {
  const { rows: liveRows } = await pool.query(`SELECT 1 FROM streams WHERE creator_id = $1 AND status = 'live'`, [
    creatorId,
  ]);
  if (!liveRows[0]) throw new AppError(400, "You must be live to boost your stream");

  // Read once per purchase, not cached — an admin changing the price via
  // Settings should take effect on the very next boost, not after a
  // restart or a TTL expiry.
  const { priceSantim, durationMs } = await getBoostPricing();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const creatorWalletId = await getUserWalletId(client, creatorId);
    const platformWalletId = await getPlatformWalletId(client);

    const balanceResult = await client.query<{ balance_santim: number }>(
      `SELECT balance_santim FROM wallet_balances_cache WHERE wallet_id = $1 FOR UPDATE`,
      [creatorWalletId]
    );
    const balance = balanceResult.rows[0]?.balance_santim ?? 0;
    if (balance < priceSantim) throw new AppError(400, "Insufficient balance");

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at)
       VALUES ('boost', 'completed', now()) RETURNING id`
    );
    const ledgerTransactionId = rows[0]!.id;

    await insertEntry(client, ledgerTransactionId, creatorWalletId, "debit", priceSantim);
    await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", priceSantim);
    await applyBalanceDelta(client, creatorWalletId, -priceSantim);
    await applyBalanceDelta(client, platformWalletId, priceSantim);

    const boostResult = await client.query<{ id: string; ends_at: string }>(
      `INSERT INTO stream_boosts (creator_id, ledger_transaction_id, ends_at, price_santim)
       VALUES ($1, $2, now() + interval '1 millisecond' * $3, $4)
       RETURNING id, ends_at`,
      [creatorId, ledgerTransactionId, durationMs, priceSantim]
    );

    await client.query("COMMIT");
    return { id: boostResult.rows[0]!.id, endsAt: boostResult.rows[0]!.ends_at };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Shared by reapStaleStreams below — unlike endStream()/markEndedByProviderStreamId(),
// this ends a specific stream by id rather than scoping by creator/provider key, since
// the reaper isn't acting on behalf of any particular caller.
async function endStreamById(streamId: string): Promise<void> {
  await pool.query(`UPDATE streams SET status = 'ended', ended_at = now() WHERE id = $1`, [streamId]);
  await logStreamEvent(streamId, "ended");
}

const STALE_STREAM_MAX_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours
const PLAYBACK_CHECK_TIMEOUT_MS = 5_000;

async function isPlaybackUrlReachable(playbackUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYBACK_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(playbackUrl, { method: "HEAD", signal: controller.signal });
    return res.ok;
  } catch {
    // Timeout, DNS failure, connection refused, TLS error, etc. — all read
    // as "not actually live" for our purposes.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

interface LiveStreamRow {
  id: string;
  playback_url: string | null;
  started_at: string | null;
}

// goLive() (above) flips a stream's status to 'live' the moment a creator
// clicks "Go live" in the dashboard — independent of whether their
// OBS/encoder has actually connected via RTMP yet. When a creator clicks Go
// Live but never gets their encoder working (or it disconnects uncleanly,
// e.g. mid-test), the on_unpublish webhook that would normally flip status
// back to 'ended' never fires, since a publish never truly started. The
// stream is then stuck showing "live" with zero video indefinitely.
//
// This sweeps every 'live' stream (see server.ts for the interval that
// calls it) and force-ends any that are actually dead, via two independent
// checks:
//   1. An HTTP HEAD against the stream's playback_url — a non-2xx (or a
//      timeout/connection failure) means there's nothing actually playing.
//   2. A hard backstop: any stream still marked 'live' after 12h is ended
//      regardless of what the HEAD check said, since a real live stream
//      running that long is implausible for this product. This catches
//      whatever the HTTP check might miss (e.g. a stale-but-still-technically
//      -200 URL).
// Each stream is checked independently — one stream's check failing (e.g.
// a network blip) must not stop the sweep from reaching the rest.
export async function reapStaleStreams(): Promise<void> {
  const { rows } = await pool.query<LiveStreamRow>(
    `SELECT id, playback_url, started_at FROM streams WHERE status = 'live'`
  );

  for (const row of rows) {
    try {
      const startedAtMs = row.started_at ? new Date(row.started_at).getTime() : null;
      const isPastMaxDuration =
        startedAtMs !== null && Date.now() - startedAtMs > STALE_STREAM_MAX_DURATION_MS;

      if (isPastMaxDuration) {
        await endStreamById(row.id);
        console.log(`[reaper] ended stream ${row.id}: max duration exceeded`);
        continue;
      }

      const reachable = row.playback_url ? await isPlaybackUrlReachable(row.playback_url) : false;
      if (!reachable) {
        await endStreamById(row.id);
        console.log(`[reaper] ended stream ${row.id}: no playback`);
      }
    } catch (err) {
      console.error(`[reaper] failed checking stream ${row.id}:`, err);
    }
  }
}

// providerStreamId is the creator's own userId (the public RTMP "stream
// name" — see composeStreamKeyField); providedKey is whatever SRS forwarded
// in `param`'s "key" query param, which must match the creator's real
// stream_key or this is either a stale/forged publish attempt or a stranger
// who only knows the (public) userId. Also closes a real gap found in the
// security audit: this is the only place that authorizes an actual RTMP
// publish, and it previously never checked is_suspended/is_banned at all —
// only the browser go-live path (goLive()) did, so a suspended creator
// could keep publishing over raw RTMP with a previously-issued key.
export async function markLiveByProviderStreamId(providerStreamId: string, providedKey: string | null): Promise<void> {
  const profile = await pool.query<CreatorProfileRow>(
    `SELECT user_id, stream_key FROM creator_profiles WHERE user_id = $1`,
    [providerStreamId]
  );
  const creatorId = profile.rows[0]?.user_id;
  if (!creatorId) throw new AppError(404, "Unknown provider stream id");
  // Constant-time compare, same reasoning as streams/routes.ts's
  // assertWebhookSecret and wallet/routes.ts's Chapa signature check — a
  // plain !== leaks timing information about how many leading characters
  // of the real stream_key matched, in principle usable to brute-force it
  // byte-by-byte. timingSafeEqualStreamKey (common/crypto.ts) also
  // transparently decrypts the stored value first (or leaves it as-is if
  // it's still a pre-encryption legacy row — see resolveStreamKey's own
  // comment) since providedKey always arrives as plaintext from RTMP.
  if (!timingSafeEqualStreamKey(providedKey, profile.rows[0]!.stream_key)) {
    throw new AppError(401, "Invalid stream key");
  }

  const userStatus = await pool.query<{ is_suspended: boolean; is_banned: boolean }>(
    `SELECT is_suspended, is_banned FROM users WHERE id = $1`,
    [creatorId]
  );
  if (userStatus.rows[0]?.is_suspended || userStatus.rows[0]?.is_banned) {
    throw new AppError(403, "Streaming privileges are currently suspended");
  }

  // SRS's on_publish callback carries no playback URL — build it ourselves.
  const playbackUrl = videoProvider.getPlaybackUrl(providerStreamId);

  // Reuse whichever row is already tracking this creator's current session:
  // either a pending 'offline' row, or — the browser/WHIP go-live flow's
  // only path — a row goLive() already flipped to 'live' moments earlier,
  // before the WHIP publish actually landed. Without matching 'live' here
  // too, that flow always falls through to the INSERT below and produces a
  // second live row for the same stream.
  const pending = await pool.query<{ id: string }>(
    `SELECT id FROM streams WHERE creator_id = $1 AND status IN ('offline', 'live')
     ORDER BY created_at DESC LIMIT 1`,
    [creatorId]
  );

  if (pending.rows[0]) {
    await pool.query(
      `UPDATE streams SET status = 'live', playback_url = $1, started_at = now() WHERE id = $2`,
      [playbackUrl, pending.rows[0].id]
    );
    await logStreamEvent(pending.rows[0].id, "started");
    return;
  }

  // A brief RTMP disconnect/reconnect (mobile network blip, encoder app
  // backgrounded and resumed) runs markEndedByProviderStreamId before this
  // fires again, so the row above is 'ended' by the time we get here —
  // without reviving it, every such blip forks a brand-new stream id.
  // That silently strands anyone already on the old one (a viewer tab, or
  // the streamer's own chat): their messages keep "working" locally
  // (nothing here validates the stream is still live), but nobody on the
  // new id ever sees them, and vice versa — confirmed live via clusters of
  // 3-4 new stream rows within a couple minutes of each other during a
  // single real mobile-broadcast session. Reviving within a short grace
  // window makes a quick reconnect invisible to anyone already watching,
  // same provider_stream_id (the creator's stable stream key) required so
  // this can't revive a different creator's session.
  const recentlyEnded = await pool.query<{ id: string }>(
    `SELECT id FROM streams WHERE provider_stream_id = $1 AND status = 'ended' AND ended_at > now() - interval '2 minutes'
     ORDER BY created_at DESC LIMIT 1`,
    [providerStreamId]
  );
  if (recentlyEnded.rows[0]) {
    await pool.query(`UPDATE streams SET status = 'live', playback_url = $1, ended_at = NULL WHERE id = $2`, [
      playbackUrl,
      recentlyEnded.rows[0].id,
    ]);
    await logStreamEvent(recentlyEnded.rows[0].id, "started");
    return;
  }

  // No pending or recently-ended row means this creator's encoder connected
  // without ever visiting the dashboard's go-live setup screen — same
  // fallback title this always used, but now also seeded from their
  // last-used category/language (if any) instead of leaving both null.
  const defaults = await getStreamDefaults(creatorId);
  const thumbnailUrl = defaults.category ? thumbnailPlaceholderUrl(defaults.category) : null;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, category, language, thumbnail_url, playback_url, provider_stream_id, status, started_at)
     VALUES ($1, 'Live Stream', $2, $3, $4, $5, $6, 'live', now())
     RETURNING id`,
    [creatorId, defaults.category, defaults.language, thumbnailUrl, playbackUrl, providerStreamId]
  );
  await logStreamEvent(rows[0]!.id, "started");
}

export async function getMostRecentStreamIdByProviderStreamId(providerStreamId: string): Promise<string | null> {
  // providerStreamId is now the userId directly (see markLiveByProviderStreamId's
  // comment) — provider_stream_id on streams is written as userId too, so
  // no join through creator_profiles is needed anymore.
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM streams WHERE provider_stream_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [providerStreamId]
  );
  return rows[0]?.id ?? null;
}

export async function markEndedByProviderStreamId(providerStreamId: string, providedKey: string | null): Promise<void> {
  const profile = await pool.query<CreatorProfileRow>(
    `SELECT user_id, stream_key FROM creator_profiles WHERE user_id = $1`,
    [providerStreamId]
  );
  const creatorId = profile.rows[0]?.user_id;
  if (!creatorId) throw new AppError(404, "Unknown provider stream id");
  // Same key check as markLiveByProviderStreamId — providerStreamId (the
  // userId) is public, so without this a forged on_unpublish for any known
  // creator would be trivial for anyone who also has the shared
  // VIDEO_WEBHOOK_SECRET (defense in depth, not the primary boundary).
  // Reuses the same decrypt-aware, timing-safe helper as the publish-time
  // check above — this used to be a plain !==, upgraded to timing-safe
  // as a side effect of needing decryption-awareness here regardless.
  if (!timingSafeEqualStreamKey(providedKey, profile.rows[0]!.stream_key)) {
    throw new AppError(401, "Invalid stream key");
  }

  const { rows } = await pool.query<{ id: string }>(
    `UPDATE streams SET status = 'ended', ended_at = now()
     WHERE creator_id = $1 AND status = 'live'
     RETURNING id`,
    [creatorId]
  );
  if (rows[0]) await logStreamEvent(rows[0].id, "ended");
}

