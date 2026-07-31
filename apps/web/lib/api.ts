import {
  activeBoostSchema,
  adCampaignAdminItemSchema,
  adCreativeAdminItemSchema,
  adLeadAdminItemSchema,
  adminAuditActionSchema,
  adminSummarySchema,
  adRevenueByCreatorSchema,
  advertiserSchema,
  anchorCandidateSchema,
  appealSchema,
  authUserSchema,
  avatarManifestSchema,
  avatarSelectionSchema,
  blocklistTermSchema,
  boostRevenueByCreatorSchema,
  creatorAdsSettingsSchema,
  creatorApplicationAdminItemSchema,
  creatorApplicationCapStatusSchema,
  creatorListItemSchema,
  creatorSearchResultSchema,
  creatorStatsSchema,
  earningsThisMonthSchema,
  followStatusSchema,
  giftCardAdminItemSchema,
  giftCardPreviewSchema,
  giftTypeSchema,
  ledgerReconciliationSchema,
  ledgerTransactionLookupSchema,
  liveStreamSchema,
  moderationActionRecordSchema,
  moderationFlagSchema,
  myCreatorApplicationSchema,
  myGiftCardSchema,
  mySubscriptionSchema,
  payoutHistoryItemSchema,
  payoutQueueItemSchema,
  platformConfigSchema,
  platformWalletSummarySchema,
  reportSchema,
  searchResultsSchema,
  servedAdSchema,
  streamActivitySchema,
  streamArchiveItemSchema,
  streamDefaultsSchema,
  streamDetailSchema,
  streamKeySchema,
  subscriptionAdminItemSchema,
  subscriptionTierSchema,
  transactionSchema,
  userListItemSchema,
  vodSchema,
  walletBalanceSchema,
  type ActiveBoost,
  type AdCampaignAdminItem,
  type AdCreativeAdminItem,
  type AdLeadAdminItem,
  type AdminAuditAction,
  type AdminSummary,
  type AdRevenueByCreator,
  type Advertiser,
  type AnchorCandidate,
  type Appeal,
  type AuthUser,
  type AvatarManifest,
  type AvatarSelection,
  type BlocklistTerm,
  type BoostRevenueByCreator,
  type CreatorAdsSettings,
  type CreatorApplicationAdminItem,
  type CreatorApplicationCapStatus,
  type CreatorListItem,
  type CreatorSearchResult,
  type CreatorStats,
  type EarningsThisMonth,
  type FollowStatus,
  type GiftCardAdminItem,
  type GiftCardPreview,
  type GiftType,
  type LedgerReconciliation,
  type LedgerTransactionLookup,
  type LiveStream,
  type ModerationActionRecord,
  type ModerationFlag,
  type MyCreatorApplication,
  type MyGiftCard,
  type MySubscription,
  type PayoutHistoryItem,
  type PayoutQueueItem,
  type PlatformConfig,
  type PlatformWalletSummary,
  type Report,
  type SearchResults,
  type ServedAd,
  type StreamActivity,
  type StreamArchiveItem,
  type StreamDefaults,
  type StreamDetail,
  type StreamKeyResponse,
  type SubscriptionAdminItem,
  type SubscriptionTier,
  type Transaction,
  type UserListItem,
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

export async function getPayoutHistory(filters: { status?: string; creator?: string }): Promise<PayoutHistoryItem[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.creator) params.set("creator", filters.creator);
  const qs = params.toString();
  const res = await fetchAuthed(`/wallet/payouts/history${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    console.error(`Failed to load payout history (${res.status})`);
    return [];
  }
  return payoutHistoryItemSchema.array().parse(await res.json());
}

export async function getModerationActions(): Promise<ModerationActionRecord[]> {
  const res = await fetchAuthed("/moderation/actions");
  if (!res.ok) {
    console.error(`Failed to load moderation action history (${res.status})`);
    return [];
  }
  return moderationActionRecordSchema.array().parse(await res.json());
}

export async function getBlocklistTerms(): Promise<BlocklistTerm[]> {
  const res = await fetchAuthed("/moderation/blocklist");
  if (!res.ok) {
    console.error(`Failed to load blocklist (${res.status})`);
    return [];
  }
  return blocklistTermSchema.array().parse(await res.json());
}

export async function getAdminAuditLog(filters: { limit?: number; action?: string } = {}): Promise<AdminAuditAction[]> {
  const params = new URLSearchParams();
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.action) params.set("action", filters.action);
  const qs = params.toString();
  const res = await fetchAuthed(`/admin/audit-log${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    console.error(`Failed to load audit log (${res.status})`);
    return [];
  }
  return adminAuditActionSchema.array().parse(await res.json());
}

export async function getAnchorCreators(): Promise<CreatorListItem[]> {
  const res = await fetchAuthed("/admin/anchor-program/creators");
  if (!res.ok) {
    console.error(`Failed to load anchor creators (${res.status})`);
    return [];
  }
  return creatorListItemSchema.array().parse(await res.json());
}

export async function getAnchorCandidates(): Promise<AnchorCandidate[]> {
  const res = await fetchAuthed("/admin/anchor-program/candidates");
  if (!res.ok) {
    console.error(`Failed to load anchor candidates (${res.status})`);
    return [];
  }
  return anchorCandidateSchema.array().parse(await res.json());
}

export async function getAdminLiveStreams(): Promise<LiveStream[]> {
  const res = await fetchAuthed("/admin/streams/live");
  if (!res.ok) {
    console.error(`Failed to load admin live streams (${res.status})`);
    return [];
  }
  return liveStreamSchema.array().parse(await res.json());
}

export async function getStreamArchive(creator?: string): Promise<StreamArchiveItem[]> {
  const qs = creator ? `?creator=${encodeURIComponent(creator)}` : "";
  const res = await fetchAuthed(`/admin/streams/archive${qs}`);
  if (!res.ok) {
    console.error(`Failed to load stream archive (${res.status})`);
    return [];
  }
  return streamArchiveItemSchema.array().parse(await res.json());
}

export async function getLedgerReconciliation(): Promise<LedgerReconciliation | null> {
  const res = await fetchAuthed("/admin/ledger/reconciliation");
  if (!res.ok) {
    console.error(`Failed to load ledger reconciliation (${res.status})`);
    return null;
  }
  return ledgerReconciliationSchema.parse(await res.json());
}

export async function getPlatformWalletSummary(): Promise<PlatformWalletSummary | null> {
  const res = await fetchAuthed("/admin/ledger/platform-wallet");
  if (!res.ok) {
    console.error(`Failed to load platform wallet summary (${res.status})`);
    return null;
  }
  return platformWalletSummarySchema.parse(await res.json());
}

export async function searchLedgerTransactions(query: string): Promise<LedgerTransactionLookup[]> {
  if (!query.trim()) return [];
  const res = await fetchAuthed(`/admin/ledger/lookup?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    console.error(`Failed to search ledger transactions (${res.status})`);
    return [];
  }
  return ledgerTransactionLookupSchema.array().parse(await res.json());
}

export async function getCreators(search?: string): Promise<CreatorListItem[]> {
  const qs = search ? `?q=${encodeURIComponent(search)}` : "";
  const res = await fetchAuthed(`/admin/creators${qs}`);
  if (!res.ok) {
    console.error(`Failed to load creators (${res.status})`);
    return [];
  }
  return creatorListItemSchema.array().parse(await res.json());
}

export async function getAdminUsers(search?: string): Promise<UserListItem[]> {
  const qs = search ? `?q=${encodeURIComponent(search)}` : "";
  const res = await fetchAuthed(`/admin/users${qs}`);
  if (!res.ok) {
    console.error(`Failed to load users (${res.status})`);
    return [];
  }
  return userListItemSchema.array().parse(await res.json());
}

export async function getBoostRevenue(): Promise<BoostRevenueByCreator[]> {
  const res = await fetchAuthed("/admin/boosts/revenue");
  if (!res.ok) {
    console.error(`Failed to load boost revenue (${res.status})`);
    return [];
  }
  return boostRevenueByCreatorSchema.array().parse(await res.json());
}

export async function getPlatformConfigData(): Promise<PlatformConfig | null> {
  const res = await fetchAuthed("/admin/config");
  if (!res.ok) {
    console.error(`Failed to load platform config (${res.status})`);
    return null;
  }
  return platformConfigSchema.parse(await res.json());
}

export async function getAdminSubscriptions(atRisk: boolean): Promise<SubscriptionAdminItem[]> {
  const res = await fetchAuthed(`/admin/subscriptions?atRisk=${atRisk}`);
  if (!res.ok) {
    console.error(`Failed to load subscriptions (${res.status})`);
    return [];
  }
  return subscriptionAdminItemSchema.array().parse(await res.json());
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

export async function getMyCreatorApplication(): Promise<MyCreatorApplication | null> {
  const res = await fetchAuthed("/creator-applications/mine");
  if (res.status === 401) return null;
  if (!res.ok) {
    console.error(`Failed to load creator application (${res.status})`);
    return null;
  }
  const body = await res.json();
  return body ? myCreatorApplicationSchema.parse(body) : null;
}

export async function getCreatorApplicationCapStatus(): Promise<CreatorApplicationCapStatus | null> {
  const res = await fetch(`${API_INTERNAL_URL}/creator-applications/cap-status`);
  if (!res.ok) {
    console.error(`Failed to load creator application cap status (${res.status})`);
    return null;
  }
  return creatorApplicationCapStatusSchema.parse(await res.json());
}

export async function getCreatorApplications(
  status?: "pending" | "approved" | "rejected"
): Promise<CreatorApplicationAdminItem[]> {
  const qs = status ? `?status=${status}` : "";
  const res = await fetchAuthed(`/admin/creator-applications${qs}`);
  if (!res.ok) {
    console.error(`Failed to load creator applications (${res.status})`);
    return [];
  }
  return creatorApplicationAdminItemSchema.array().parse(await res.json());
}

// --- Ads (B.2) ---

export async function getServedAd(streamId: string, format: string): Promise<ServedAd | null> {
  const res = await fetchAuthed(`/ads/serve?streamId=${streamId}&format=${format}`);
  if (!res.ok) return null;
  const body = await res.json();
  return body ? servedAdSchema.parse(body) : null;
}

export async function getSponsoredCard(category?: string, language?: string): Promise<ServedAd | null> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (language) params.set("language", language);
  const res = await fetch(`${API_INTERNAL_URL}/ads/sponsored-card?${params.toString()}`);
  if (!res.ok) return null;
  const body = await res.json();
  return body ? servedAdSchema.parse(body) : null;
}

export async function getCreatorAdsSettings(): Promise<CreatorAdsSettings | null> {
  const res = await fetchAuthed("/ads/creator-settings");
  if (!res.ok) {
    console.error(`Failed to load creator ads settings (${res.status})`);
    return null;
  }
  return creatorAdsSettingsSchema.parse(await res.json());
}

export async function getAdvertisers(): Promise<Advertiser[]> {
  const res = await fetchAuthed("/admin/advertisers");
  if (!res.ok) {
    console.error(`Failed to load advertisers (${res.status})`);
    return [];
  }
  return advertiserSchema.array().parse(await res.json());
}

export async function getAdCampaigns(): Promise<AdCampaignAdminItem[]> {
  const res = await fetchAuthed("/admin/ad-campaigns");
  if (!res.ok) {
    console.error(`Failed to load ad campaigns (${res.status})`);
    return [];
  }
  return adCampaignAdminItemSchema.array().parse(await res.json());
}

export async function getAdCreatives(campaignId: string): Promise<AdCreativeAdminItem[]> {
  const res = await fetchAuthed(`/admin/ad-campaigns/${campaignId}/creatives`);
  if (!res.ok) {
    console.error(`Failed to load ad creatives (${res.status})`);
    return [];
  }
  return adCreativeAdminItemSchema.array().parse(await res.json());
}

export async function getAdLeads(): Promise<AdLeadAdminItem[]> {
  const res = await fetchAuthed("/admin/ad-leads");
  if (!res.ok) {
    console.error(`Failed to load ad leads (${res.status})`);
    return [];
  }
  return adLeadAdminItemSchema.array().parse(await res.json());
}

export async function getAdRevenueByCreator(): Promise<AdRevenueByCreator[]> {
  const res = await fetchAuthed("/admin/ad-revenue");
  if (!res.ok) {
    console.error(`Failed to load ad revenue (${res.status})`);
    return [];
  }
  return adRevenueByCreatorSchema.array().parse(await res.json());
}

// --- Gift cards (B.3) ---

export async function getMyGiftCards(): Promise<MyGiftCard[]> {
  const res = await fetchAuthed("/gift-cards/mine");
  if (!res.ok) {
    console.error(`Failed to load gift cards (${res.status})`);
    return [];
  }
  return myGiftCardSchema.array().parse(await res.json());
}

export async function getGiftCardPreview(code: string): Promise<GiftCardPreview | null> {
  const res = await fetch(`${API_INTERNAL_URL}/gift-cards/preview?code=${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  const body = await res.json();
  return body ? giftCardPreviewSchema.parse(body) : null;
}

export async function getGiftCardsAdmin(status?: string): Promise<GiftCardAdminItem[]> {
  const qs = status ? `?status=${status}` : "";
  const res = await fetchAuthed(`/admin/gift-cards${qs}`);
  if (!res.ok) {
    console.error(`Failed to load gift cards (${res.status})`);
    return [];
  }
  return giftCardAdminItemSchema.array().parse(await res.json());
}

export async function getSuspiciousGiftCardPurchasers(): Promise<{ username: string; count: number }[]> {
  const res = await fetchAuthed("/admin/gift-cards/suspicious");
  if (!res.ok) return [];
  return res.json();
}
