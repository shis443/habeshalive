import {
  activeBoostSchema,
  adminSummarySchema,
  appealSchema,
  authUserSchema,
  avatarManifestSchema,
  avatarSelectionSchema,
  creatorSearchResultSchema,
  creatorStatsSchema,
  earningsThisMonthSchema,
  followStatusSchema,
  giftTypeSchema,
  liveStreamSchema,
  moderationFlagSchema,
  mySubscriptionSchema,
  payoutQueueItemSchema,
  reportSchema,
  searchResultsSchema,
  streamActivitySchema,
  streamDefaultsSchema,
  streamDetailSchema,
  streamKeySchema,
  subscriptionTierSchema,
  transactionSchema,
  vodSchema,
  walletBalanceSchema,
  type ActiveBoost,
  type AdminSummary,
  type Appeal,
  type AuthUser,
  type AvatarManifest,
  type AvatarSelection,
  type CreatorSearchResult,
  type CreatorStats,
  type EarningsThisMonth,
  type FollowStatus,
  type GiftType,
  type LiveStream,
  type ModerationFlag,
  type MySubscription,
  type PayoutQueueItem,
  type Report,
  type SearchResults,
  type StreamActivity,
  type StreamDefaults,
  type StreamDetail,
  type StreamKeyResponse,
  type SubscriptionTier,
  type Transaction,
  type Vod,
  type WalletBalance,
} from "@habeshalive/shared";
// Every function in this file runs server-side only (Server Components), so
// it uses API_INTERNAL_URL — see config.ts for why that differs from
// API_BASE_URL when containerized.
import { API_INTERNAL_URL } from "./config";
import { fetchAuthed } from "./session";

// Uses fetchAuthed (not a plain fetch) even though this route never
// requires auth — an Authorization header, when a visitor happens to be
// logged in, is how the API resolves their "show sensitive content"
// preference (see db/migrations/0012). Anonymous visitors still work
// fine: fetchAuthed just omits the header when there's no session.
export async function getLiveStreams(category?: string): Promise<LiveStream[]> {
  const path = category ? `/streams/live?category=${encodeURIComponent(category)}` : `/streams/live`;
  const res = await fetchAuthed(path);
  if (!res.ok) {
    // The homepage's primary data fetch — a k6 load test caught this
    // throwing on any non-200 (including a transient 429 from the API's
    // own rate limiter, since every visitor's page load funnels through
    // this one server-side call) and crashing the entire page with
    // Next.js's generic error screen for every visitor, not just
    // whoever/whatever triggered the backend hiccup. Degrading to an
    // empty list is a real product tradeoff (no streams shown) but it's
    // a far better failure mode than the whole homepage going down.
    console.error(`Failed to load live streams (${res.status})`);
    return [];
  }
  const data = await res.json();
  return liveStreamSchema.array().parse(data);
}

// Same fetchAuthed reasoning as getLiveStreams above.
export async function getLiveStreamByUsername(username: string): Promise<StreamDetail | null> {
  const res = await fetchAuthed(`/streams/username/${encodeURIComponent(username)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    // Same degrade-not-crash reasoning as getLiveStreams — the watch page
    // already renders a "not found" state for a null stream, so a
    // transient backend error reuses that path instead of a hard crash.
    console.error(`Failed to load stream (${res.status})`);
    return null;
  }
  const data = await res.json();
  return streamDetailSchema.parse(data);
}

export async function getStreamActivity(streamId: string): Promise<StreamActivity> {
  const res = await fetch(`${API_INTERNAL_URL}/streams/${streamId}/activity`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Failed to load stream activity (${res.status})`);
    return { giftsCount: 0, activeSubscribers: 0, recentEvents: [] };
  }
  return streamActivitySchema.parse(await res.json());
}

// Same fetchAuthed reasoning as getLiveStreams above.
export async function search(query: string): Promise<SearchResults> {
  if (!query.trim()) return { streams: [], creators: [] };
  const res = await fetchAuthed(`/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    // Same reasoning as getLiveStreams above — degrade to "no results"
    // rather than crash the /search page on a transient backend error.
    console.error(`Search failed (${res.status})`);
    return { streams: [], creators: [] };
  }
  return searchResultsSchema.parse(await res.json());
}

export async function getGiftTypes(): Promise<GiftType[]> {
  const res = await fetch(`${API_INTERNAL_URL}/wallet/gift-types`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Failed to load gift types (${res.status})`);
    return [];
  }
  return giftTypeSchema.array().parse(await res.json());
}

export async function getSubscriptionTiers(): Promise<SubscriptionTier[]> {
  const res = await fetch(`${API_INTERNAL_URL}/subscriptions/tiers`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Failed to load subscription tiers (${res.status})`);
    return [];
  }
  return subscriptionTierSchema.array().parse(await res.json());
}

// Authenticated reads for Server Components — return null on any non-200
// (not just 401) so callers can treat "couldn't verify" the same as
// "not logged in" rather than throwing. getCurrentUser specifically is
// called on nearly every page (TopNav needs isAuthed) — a k6 load test
// caught this throwing on a transient 429 and crashing every single page
// on the site, not just the ones that need auth, since it's this
// universal. Worst case now is a logged-in user briefly seeing the
// logged-out nav during a backend hiccup — real degradation, but nowhere
// near as bad as the whole site 500ing.
export async function getCurrentUser(): Promise<AuthUser | null> {
  const res = await fetchAuthed("/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load current user (${res.status})`);
    return null;
  }
  return authUserSchema.parse(await res.json());
}

export async function getFollowedCreators(): Promise<CreatorSearchResult[] | null> {
  const res = await fetchAuthed("/follows/mine");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load followed creators (${res.status})`);
    return null;
  }
  return creatorSearchResultSchema.array().parse(await res.json());
}

export async function getStreamKey(): Promise<StreamKeyResponse | null> {
  const res = await fetchAuthed("/streams/key");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load stream key (${res.status})`);
    return null;
  }
  return streamKeySchema.parse(await res.json());
}

export async function getVods(username: string): Promise<Vod[]> {
  const res = await fetch(`${API_INTERNAL_URL}/vods/${encodeURIComponent(username)}`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`Failed to load VODs for ${username} (${res.status})`);
    return [];
  }
  return vodSchema.array().parse(await res.json());
}

export async function getStreamDefaults(): Promise<StreamDefaults | null> {
  const res = await fetchAuthed("/streams/defaults");
  if (!res.ok) {
    console.error(`Failed to load stream defaults (${res.status})`);
    return null;
  }
  return streamDefaultsSchema.parse(await res.json());
}

export async function getWalletBalance(): Promise<WalletBalance | null> {
  const res = await fetchAuthed("/wallet/balance");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load balance (${res.status})`);
    return null;
  }
  return walletBalanceSchema.parse(await res.json());
}

export async function getEarningsThisMonth(): Promise<EarningsThisMonth | null> {
  const res = await fetchAuthed("/wallet/earnings-this-month");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load earnings (${res.status})`);
    return null;
  }
  return earningsThisMonthSchema.parse(await res.json());
}

export async function getCreatorStats(): Promise<CreatorStats | null> {
  const res = await fetchAuthed("/streams/creator-stats");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load creator stats (${res.status})`);
    return null;
  }
  return creatorStatsSchema.parse(await res.json());
}

export async function getTransactions(): Promise<Transaction[] | null> {
  const res = await fetchAuthed("/wallet/transactions");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load transactions (${res.status})`);
    return null;
  }
  return transactionSchema.array().parse(await res.json());
}

export async function getMySubscriptions(): Promise<MySubscription[] | null> {
  const res = await fetchAuthed("/subscriptions/mine");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load subscriptions (${res.status})`);
    return null;
  }
  return mySubscriptionSchema.array().parse(await res.json());
}

// Public: follower count is visible to anonymous viewers, and "following"
// gracefully defaults to false when there's no session (and now also on
// any backend error, same reasoning as the rest of this file).
export async function getFollowStatus(creatorId: string): Promise<FollowStatus> {
  const res = await fetchAuthed(`/follows/${creatorId}/status`);
  if (!res.ok) {
    console.error(`Failed to load follow status (${res.status})`);
    return { following: false, followerCount: 0 };
  }
  return followStatusSchema.parse(await res.json());
}

// Left throwing, unlike the rest of this file after the k6 finding above:
// there's no safe empty AvatarManifest to degrade to (it's a fixed part
// catalog, not a list of results) that wouldn't itself confuse the editor
// UI, and this is a single low-traffic opt-in page, not something on
// every visitor's path the way getCurrentUser/getLiveStreams are.
export async function getAvatarParts(): Promise<AvatarManifest> {
  const res = await fetch(`${API_INTERNAL_URL}/avatars/parts`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load avatar parts (${res.status})`);
  return avatarManifestSchema.parse(await res.json());
}

export async function getAvatarSelection(): Promise<AvatarSelection | null> {
  const res = await fetchAuthed("/avatars/me");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load avatar selection (${res.status})`);
    return null;
  }
  return avatarSelectionSchema.parse(await res.json());
}

// Admin-only reads. Lower urgency than the functions above (only admins
// hit /admin, not every visitor), but fixed for the same reason — degrade
// on a transient error rather than 500 the whole dashboard, consistent
// with every other function in this file after the k6 finding.
export async function getAdminSummary(): Promise<AdminSummary | null> {
  const res = await fetchAuthed("/admin/summary");
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) {
    console.error(`Failed to load admin summary (${res.status})`);
    return null;
  }
  return adminSummarySchema.parse(await res.json());
}

export async function getPendingPayouts(): Promise<PayoutQueueItem[]> {
  const res = await fetchAuthed("/wallet/payouts/pending");
  if (!res.ok) {
    console.error(`Failed to load pending payouts (${res.status})`);
    return [];
  }
  return payoutQueueItemSchema.array().parse(await res.json());
}

export async function getModerationQueue(): Promise<ModerationFlag[]> {
  const res = await fetchAuthed("/moderation/queue");
  if (!res.ok) {
    console.error(`Failed to load moderation queue (${res.status})`);
    return [];
  }
  return moderationFlagSchema.array().parse(await res.json());
}

export async function getActiveBoosts(): Promise<ActiveBoost[]> {
  const res = await fetchAuthed("/admin/boosts");
  if (!res.ok) {
    console.error(`Failed to load active boosts (${res.status})`);
    return [];
  }
  return activeBoostSchema.array().parse(await res.json());
}

export async function getReports(): Promise<Report[]> {
  const res = await fetchAuthed("/moderation/reports");
  if (!res.ok) {
    console.error(`Failed to load reports (${res.status})`);
    return [];
  }
  return reportSchema.array().parse(await res.json());
}

export async function getAppeals(): Promise<Appeal[]> {
  const res = await fetchAuthed("/moderation/appeals");
  if (!res.ok) {
    console.error(`Failed to load appeals (${res.status})`);
    return [];
  }
  return appealSchema.array().parse(await res.json());
}
