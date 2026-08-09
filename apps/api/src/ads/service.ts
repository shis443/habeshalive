import type {
  AdCampaignAdminItem,
  AdCreativeAdminItem,
  AdFormat,
  AdLeadAdminItem,
  Advertiser,
  AdRevenueByCreator,
  CreateAdCampaignInput,
  CreateAdCreativeInput,
  CreateAdvertiserInput,
  CreatorAdsSettings,
  ServedAd,
  SubmitAdLeadInput,
} from "@birq/shared";
import { logAdminAction } from "../admin/audit.js";
import { getAdConfig } from "../admin/config-service.js";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";

// --- Ad serving ---

// Deliberately not per-impression ledger writes — see db/migrations/0020's
// comment on ad_impressions.settled. Impressions are cheap inserts here;
// real money moves in settleAdRevenue() below, batched.
export async function getAdForStream(
  streamId: string,
  viewerId: string | null,
  format: AdFormat
): Promise<ServedAd | null> {
  const streamResult = await pool.query<{
    category: string | null;
    language: string | null;
    peak_viewers: number;
    creator_id: string;
    ads_enabled: boolean;
  }>(
    `SELECT s.category, s.language, s.peak_viewers, s.creator_id, cp.ads_enabled
     FROM streams s JOIN creator_profiles cp ON cp.user_id = s.creator_id
     WHERE s.id = $1`,
    [streamId]
  );
  const stream = streamResult.rows[0];
  if (!stream || !stream.ads_enabled) return null;

  if (viewerId) {
    const subResult = await pool.query(
      `SELECT 1 FROM subscriptions WHERE subscriber_id = $1 AND creator_id = $2 AND status = 'active'`,
      [viewerId, stream.creator_id]
    );
    // Subscriber ad-free viewing — a genuine, concrete subscribe incentive.
    if (subResult.rows[0]) return null;

    // Platform-wide sliding-scale subscription (0025_gursha_gift_economy.sql)
    // exempts every creator's stream, not just one — separate check since
    // it's a different table with no creator_id to match against.
    const platformSubResult = await pool.query(
      `SELECT 1 FROM platform_subscriptions WHERE subscriber_id = $1 AND status = 'active'`,
      [viewerId]
    );
    if (platformSubResult.rows[0]) return null;
  }

  const { frequencyCapPerHour } = await getAdConfig();

  const { rows } = await pool.query<{
    id: string;
    format: AdFormat;
    asset_url: string;
    click_url: string | null;
    duration_seconds: number | null;
    advertiser_name: string;
  }>(
    `SELECT ac.id, ac.format, ac.asset_url, ac.click_url, ac.duration_seconds, adv.name AS advertiser_name
     FROM ad_creatives ac
     JOIN ad_campaigns camp ON camp.id = ac.campaign_id
     JOIN advertisers adv ON adv.id = camp.advertiser_id
     LEFT JOIN ad_targeting t ON t.campaign_id = camp.id
     WHERE ac.approved = TRUE
       AND ac.format = $1
       AND camp.status = 'active'
       AND camp.starts_at <= now() AND camp.ends_at >= now()
       AND camp.spent_santim < camp.budget_santim
       AND adv.status = 'active'
       AND (t.category IS NULL OR t.category = $2)
       AND (t.language IS NULL OR t.language = $3)
       AND (t.min_viewers IS NULL OR t.min_viewers <= $4)
       AND (
         $5::uuid IS NULL OR ac.id NOT IN (
           SELECT creative_id FROM ad_impressions
           WHERE viewer_id = $5 AND served_at > now() - interval '1 hour'
           GROUP BY creative_id HAVING count(*) >= $6
         )
       )
     ORDER BY random()
     LIMIT 1`,
    [format, stream.category, stream.language, stream.peak_viewers, viewerId, frequencyCapPerHour]
  );
  const ad = rows[0];
  if (!ad) return null;

  const { rows: impressionRows } = await pool.query<{ id: string }>(
    `INSERT INTO ad_impressions (creative_id, stream_id, creator_id, viewer_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [ad.id, streamId, stream.creator_id, viewerId]
  );

  return {
    impressionId: impressionRows[0]!.id,
    format: ad.format,
    assetUrl: ad.asset_url,
    clickUrl: ad.click_url,
    durationSeconds: ad.duration_seconds,
    advertiserName: ad.advertiser_name,
  };
}

// Sponsored stream cards are a directory placement, not attached to any
// one creator's stream — architecturally distinct from creator-bought
// Boosts per the spec ("different buyer, different table, different admin
// view"), so unlike getAdForStream() above this has no ads_enabled gate
// and no PER-CREATOR subscriber-ad-free exemption (there's no specific
// creator to be subscribed to). It does still honor the PLATFORM-wide
// subscription (0025_gursha_gift_economy.sql) below, since that one is
// explicitly platform-wide by design, not tied to any creator either.
// Records an impression with stream_id/creator_id both null, so it never
// enters a creator's ad-revenue settlement — a sponsored card's revenue
// stays fully platform-side, the advertiser paid for directory placement,
// not a creator's audience.
export async function getSponsoredCard(
  category: string | null,
  language: string | null,
  viewerId: string | null
): Promise<ServedAd | null> {
  if (viewerId) {
    const platformSubResult = await pool.query(
      `SELECT 1 FROM platform_subscriptions WHERE subscriber_id = $1 AND status = 'active'`,
      [viewerId]
    );
    if (platformSubResult.rows[0]) return null;
  }

  const { rows } = await pool.query<{
    id: string;
    campaign_id: string;
    cpm_santim: number;
    format: AdFormat;
    asset_url: string;
    click_url: string | null;
    duration_seconds: number | null;
    advertiser_name: string;
  }>(
    `SELECT ac.id, camp.id AS campaign_id, camp.cpm_santim, ac.format, ac.asset_url, ac.click_url, ac.duration_seconds,
            adv.name AS advertiser_name
     FROM ad_creatives ac
     JOIN ad_campaigns camp ON camp.id = ac.campaign_id
     JOIN advertisers adv ON adv.id = camp.advertiser_id
     LEFT JOIN ad_targeting t ON t.campaign_id = camp.id
     WHERE ac.approved = TRUE
       AND ac.format = 'sponsored_card'
       AND camp.status = 'active'
       AND camp.starts_at <= now() AND camp.ends_at >= now()
       AND camp.spent_santim < camp.budget_santim
       AND adv.status = 'active'
       AND (t.category IS NULL OR t.category = $1)
       AND (t.language IS NULL OR t.language = $2)
     ORDER BY random()
     LIMIT 1`,
    [category, language]
  );
  const ad = rows[0];
  if (!ad) return null;

  const { rows: impressionRows } = await pool.query<{ id: string }>(
    // Marked settled immediately: no creator/wallet is involved (revenue
    // stays fully platform-side), so there's nothing for settleAdRevenue()
    // to do with this row — leaving settled=FALSE would just make it show
    // up in that job's per-creator scan forever for no reason.
    `INSERT INTO ad_impressions (creative_id, stream_id, creator_id, viewer_id, settled) VALUES ($1, NULL, NULL, NULL, TRUE) RETURNING id`,
    [ad.id]
  );
  // No batching concern here unlike getAdForStream's path — this is a
  // plain counter increment, not a ledger_transaction + entries + balance
  // cache write, so doing it inline per-impression is cheap and correct.
  await pool.query(`UPDATE ad_campaigns SET spent_santim = spent_santim + $1 WHERE id = $2`, [
    Math.floor(ad.cpm_santim / 1000),
    ad.campaign_id,
  ]);

  return {
    impressionId: impressionRows[0]!.id,
    format: ad.format,
    assetUrl: ad.asset_url,
    clickUrl: ad.click_url,
    durationSeconds: ad.duration_seconds,
    advertiserName: ad.advertiser_name,
  };
}

export async function recordAdClick(impressionId: string): Promise<void> {
  const { rows } = await pool.query(`SELECT 1 FROM ad_impressions WHERE id = $1`, [impressionId]);
  if (!rows[0]) throw new AppError(404, "Impression not found");
  await pool.query(`INSERT INTO ad_clicks (impression_id) VALUES ($1)`, [impressionId]);
}

// Periodic batch settlement (same "reaper" pattern as server.ts's
// stale-stream/VOD-cleanup jobs) — one real ledger_transaction per creator
// per run, not one per impression. Each creative's cost-per-impression is
// campaign.cpm_santim / 1000, truncated same as every other revenue split
// in this codebase (favors the platform by at most a few santim, see
// wallet/service.ts's sendGift comment on the same tradeoff).
export async function settleAdRevenue(): Promise<void> {
  const { revenueShareBps } = await getAdConfig();

  const { rows: creators } = await pool.query<{ creator_id: string }>(
    `SELECT DISTINCT creator_id FROM ad_impressions WHERE settled = FALSE AND creator_id IS NOT NULL`
  );

  for (const { creator_id: creatorId } of creators) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: unsettled } = await client.query<{ id: string; cpm_santim: number }>(
        `SELECT ai.id, camp.cpm_santim
         FROM ad_impressions ai
         JOIN ad_creatives ac ON ac.id = ai.creative_id
         JOIN ad_campaigns camp ON camp.id = ac.campaign_id
         WHERE ai.creator_id = $1 AND ai.settled = FALSE
         FOR UPDATE OF ai`,
        [creatorId]
      );
      if (unsettled.length === 0) {
        await client.query("COMMIT");
        continue;
      }

      const totalCost = unsettled.reduce((sum, row) => sum + Math.floor(row.cpm_santim / 1000), 0);
      if (totalCost <= 0) {
        // Nothing billable (e.g. a very low CPM truncates to 0/impression)
        // — still mark settled so this batch doesn't get re-scanned forever.
        await client.query(
          `UPDATE ad_impressions SET settled = TRUE WHERE id = ANY($1)`,
          [unsettled.map((r) => r.id)]
        );
        await client.query("COMMIT");
        continue;
      }

      const creatorShare = Math.trunc((totalCost * revenueShareBps) / 10_000);
      const platformShare = totalCost - creatorShare;

      const creatorWalletId = await getUserWalletId(client, creatorId);
      const platformWalletId = await getPlatformWalletId(client);

      const { rows: txRows } = await client.query<{ id: string }>(
        `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('ad', 'completed', now()) RETURNING id`
      );
      const ledgerTransactionId = txRows[0]!.id;

      // Platform wallet is the source (the advertiser already paid Birq
      // externally for campaign budget — same "clearing account for
      // value entering the system" role the platform wallet plays for
      // topups), split out to the creator's share.
      await insertEntry(client, ledgerTransactionId, platformWalletId, "debit", totalCost);
      await insertEntry(client, ledgerTransactionId, creatorWalletId, "credit", creatorShare);
      await insertEntry(client, ledgerTransactionId, platformWalletId, "credit", platformShare);

      await applyBalanceDelta(client, platformWalletId, -totalCost + platformShare);
      await applyBalanceDelta(client, creatorWalletId, creatorShare);

      await client.query(
        `UPDATE ad_impressions SET settled = TRUE, settled_ledger_transaction_id = $1 WHERE id = ANY($2)`,
        [ledgerTransactionId, unsettled.map((r) => r.id)]
      );

      // Campaign spend tracking — per campaign, not just per creator,
      // since budget_santim caps a campaign across every creator it ran on.
      const byCampaign = new Map<string, number>();
      const { rows: campaignCosts } = await client.query<{ campaign_id: string; cpm_santim: number; count: string }>(
        `SELECT camp.id AS campaign_id, camp.cpm_santim, count(*) AS count
         FROM ad_impressions ai
         JOIN ad_creatives ac ON ac.id = ai.creative_id
         JOIN ad_campaigns camp ON camp.id = ac.campaign_id
         WHERE ai.id = ANY($1)
         GROUP BY camp.id, camp.cpm_santim`,
        [unsettled.map((r) => r.id)]
      );
      for (const row of campaignCosts) {
        byCampaign.set(row.campaign_id, Math.floor(row.cpm_santim / 1000) * Number(row.count));
      }
      for (const [campaignId, cost] of byCampaign) {
        await client.query(`UPDATE ad_campaigns SET spent_santim = spent_santim + $1 WHERE id = $2`, [cost, campaignId]);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[ads] settlement failed for creator ${creatorId}:`, err);
    } finally {
      client.release();
    }
  }
}

// --- Creator Ads Manager ---

export async function getCreatorAdsSettings(creatorId: string): Promise<CreatorAdsSettings> {
  const { rows } = await pool.query<{ ads_enabled: boolean }>(
    `SELECT ads_enabled FROM creator_profiles WHERE user_id = $1`,
    [creatorId]
  );
  if (!rows[0]) throw new AppError(404, "Creator profile not found");

  const walletId = await getUserWalletId(pool, creatorId);
  const { rows: revenueRows } = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(le.amount_santim), 0)::bigint AS total
     FROM ledger_entries le
     JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
     WHERE le.wallet_id = $1 AND le.direction = 'credit' AND lt.type = 'ad'
       AND lt.created_at >= date_trunc('month', now())`,
    [walletId]
  );

  return { adsEnabled: rows[0].ads_enabled, revenueThisMonthSantim: revenueRows[0]?.total ?? 0 };
}

export async function updateCreatorAdsSettings(creatorId: string, adsEnabled: boolean): Promise<CreatorAdsSettings> {
  const { rowCount } = await pool.query(`UPDATE creator_profiles SET ads_enabled = $1 WHERE user_id = $2`, [
    adsEnabled,
    creatorId,
  ]);
  if (!rowCount) throw new AppError(404, "Creator profile not found");
  return getCreatorAdsSettings(creatorId);
}

// --- Public: leads ---

export async function submitAdLead(input: SubmitAdLeadInput): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ad_leads (company_name, contact_name, contact_email, message)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.companyName, input.contactName, input.contactEmail, input.message ?? null]
  );
  return { id: rows[0]!.id };
}

// --- Admin ---

export async function createAdvertiser(adminId: string, input: CreateAdvertiserInput): Promise<Advertiser> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    contact_email: string | null;
    contact_phone: string | null;
    status: "active" | "paused" | "archived";
    created_at: string;
  }>(
    `INSERT INTO advertisers (name, contact_email, contact_phone) VALUES ($1, $2, $3)
     RETURNING id, name, contact_email, contact_phone, status, created_at`,
    [input.name, input.contactEmail ?? null, input.contactPhone ?? null]
  );
  const row = rows[0]!;
  await logAdminAction(adminId, "advertiser.create", "advertiser", row.id);
  return {
    id: row.id,
    name: row.name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listAdvertisers(): Promise<Advertiser[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    contact_email: string | null;
    contact_phone: string | null;
    status: "active" | "paused" | "archived";
    created_at: string;
  }>(`SELECT id, name, contact_email, contact_phone, status, created_at FROM advertisers ORDER BY created_at DESC`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function createAdCampaign(adminId: string, input: CreateAdCampaignInput): Promise<AdCampaignAdminItem> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ad_campaigns (advertiser_id, name, budget_santim, cpm_santim, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.advertiserId, input.name, input.budgetSantim, input.cpmSantim, input.startsAt, input.endsAt]
  );
  const campaignId = rows[0]!.id;

  if (input.targeting) {
    await pool.query(
      `INSERT INTO ad_targeting (campaign_id, category, language, min_viewers) VALUES ($1, $2, $3, $4)`,
      [campaignId, input.targeting.category ?? null, input.targeting.language ?? null, input.targeting.minViewers ?? null]
    );
  }

  await logAdminAction(adminId, "ad_campaign.create", "ad_campaign", campaignId, { metadata: input });
  const items = await listAdCampaigns();
  return items.find((c) => c.id === campaignId)!;
}

export async function listAdCampaigns(): Promise<AdCampaignAdminItem[]> {
  const { rows } = await pool.query<{
    id: string;
    advertiser_id: string;
    advertiser_name: string;
    name: string;
    budget_santim: number;
    spent_santim: number;
    cpm_santim: number;
    starts_at: string;
    ends_at: string;
    status: "draft" | "pending_review" | "active" | "paused" | "completed";
    target_category: string | null;
    target_language: string | null;
    target_min_viewers: number | null;
    creative_count: string;
    impression_count: string;
    click_count: string;
    created_at: string;
  }>(
    `SELECT camp.id, camp.advertiser_id, adv.name AS advertiser_name, camp.name, camp.budget_santim, camp.spent_santim,
            camp.cpm_santim, camp.starts_at, camp.ends_at, camp.status,
            t.category AS target_category, t.language AS target_language, t.min_viewers AS target_min_viewers,
            (SELECT count(*) FROM ad_creatives WHERE campaign_id = camp.id) AS creative_count,
            (SELECT count(*) FROM ad_impressions ai JOIN ad_creatives ac ON ac.id = ai.creative_id WHERE ac.campaign_id = camp.id) AS impression_count,
            (SELECT count(*) FROM ad_clicks cl JOIN ad_impressions ai ON ai.id = cl.impression_id JOIN ad_creatives ac ON ac.id = ai.creative_id WHERE ac.campaign_id = camp.id) AS click_count,
            camp.created_at
     FROM ad_campaigns camp
     JOIN advertisers adv ON adv.id = camp.advertiser_id
     LEFT JOIN ad_targeting t ON t.campaign_id = camp.id
     ORDER BY camp.created_at DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    advertiserId: row.advertiser_id,
    advertiserName: row.advertiser_name,
    name: row.name,
    budgetSantim: row.budget_santim,
    spentSantim: row.spent_santim,
    cpmSantim: row.cpm_santim,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    targeting:
      row.target_category || row.target_language || row.target_min_viewers != null
        ? { category: row.target_category, language: row.target_language, minViewers: row.target_min_viewers }
        : null,
    creativeCount: Number(row.creative_count),
    impressionCount: Number(row.impression_count),
    clickCount: Number(row.click_count),
    createdAt: row.created_at,
  }));
}

export async function updateAdCampaignStatus(
  adminId: string,
  campaignId: string,
  status: "draft" | "pending_review" | "active" | "paused" | "completed"
): Promise<void> {
  // A campaign can't go active with zero approved creatives — nothing
  // would actually serve, and it's a common real mistake to catch here
  // rather than silently letting a "live" campaign spend nothing forever.
  if (status === "active") {
    const { rows } = await pool.query(
      `SELECT 1 FROM ad_creatives WHERE campaign_id = $1 AND approved = TRUE LIMIT 1`,
      [campaignId]
    );
    if (!rows[0]) throw new AppError(400, "Campaign has no approved creatives — approve at least one first.");
  }
  const { rowCount } = await pool.query(`UPDATE ad_campaigns SET status = $1 WHERE id = $2`, [status, campaignId]);
  if (!rowCount) throw new AppError(404, "Campaign not found");
  await logAdminAction(adminId, "ad_campaign.update_status", "ad_campaign", campaignId, { metadata: { status } });
}

export async function createAdCreative(adminId: string, input: CreateAdCreativeInput): Promise<AdCreativeAdminItem> {
  const { rows } = await pool.query<{
    id: string;
    campaign_id: string;
    format: AdFormat;
    asset_url: string;
    click_url: string | null;
    duration_seconds: number | null;
    approved: boolean;
    created_at: string;
  }>(
    `INSERT INTO ad_creatives (campaign_id, format, asset_url, click_url, duration_seconds)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, campaign_id, format, asset_url, click_url, duration_seconds, approved, created_at`,
    [input.campaignId, input.format, input.assetUrl, input.clickUrl ?? null, input.durationSeconds ?? null]
  );
  const row = rows[0]!;
  await logAdminAction(adminId, "ad_creative.create", "ad_creative", row.id);
  return {
    id: row.id,
    campaignId: row.campaign_id,
    format: row.format,
    assetUrl: row.asset_url,
    clickUrl: row.click_url,
    durationSeconds: row.duration_seconds,
    approved: row.approved,
    createdAt: row.created_at,
  };
}

export async function listAdCreatives(campaignId: string): Promise<AdCreativeAdminItem[]> {
  const { rows } = await pool.query<{
    id: string;
    campaign_id: string;
    format: AdFormat;
    asset_url: string;
    click_url: string | null;
    duration_seconds: number | null;
    approved: boolean;
    created_at: string;
  }>(
    `SELECT id, campaign_id, format, asset_url, click_url, duration_seconds, approved, created_at
     FROM ad_creatives WHERE campaign_id = $1 ORDER BY created_at DESC`,
    [campaignId]
  );
  return rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    format: row.format,
    assetUrl: row.asset_url,
    clickUrl: row.click_url,
    durationSeconds: row.duration_seconds,
    approved: row.approved,
    createdAt: row.created_at,
  }));
}

// No creative serves before approval — enforced by getAdForStream()'s own
// query (WHERE ac.approved = TRUE), this just flips the flag.
export async function approveAdCreative(adminId: string, creativeId: string): Promise<void> {
  const { rowCount } = await pool.query(`UPDATE ad_creatives SET approved = TRUE WHERE id = $1`, [creativeId]);
  if (!rowCount) throw new AppError(404, "Creative not found");
  await logAdminAction(adminId, "ad_creative.approve", "ad_creative", creativeId);
}

export async function listAdLeads(): Promise<AdLeadAdminItem[]> {
  const { rows } = await pool.query<{
    id: string;
    company_name: string;
    contact_name: string;
    contact_email: string;
    message: string | null;
    status: "new" | "contacted" | "closed";
    created_at: string;
  }>(`SELECT id, company_name, contact_name, contact_email, message, status, created_at FROM ad_leads ORDER BY created_at DESC`);
  return rows.map((row) => ({
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function updateAdLeadStatus(
  adminId: string,
  leadId: string,
  status: "new" | "contacted" | "closed"
): Promise<void> {
  const { rowCount } = await pool.query(`UPDATE ad_leads SET status = $1 WHERE id = $2`, [status, leadId]);
  if (!rowCount) throw new AppError(404, "Lead not found");
  await logAdminAction(adminId, "ad_lead.update_status", "ad_lead", leadId, { metadata: { status } });
}

// Two independently-aggregated subqueries joined on creator_id, not a
// single query joining ad_impressions straight to ledger_entries: many
// impressions settle into ONE batched ledger_transaction (see
// settleAdRevenue()), so a naive join would multiply that transaction's
// credit entry once per impression row and wildly overcount revenue.
export async function getAdRevenueByCreator(): Promise<AdRevenueByCreator[]> {
  const { rows } = await pool.query<{ creator_id: string; username: string; impression_count: string; total: string | null }>(
    `SELECT ic.creator_id, u.username, ic.impression_count, rev.total
     FROM (
       SELECT creator_id, count(*) AS impression_count
       FROM ad_impressions
       WHERE creator_id IS NOT NULL
       GROUP BY creator_id
     ) ic
     JOIN users u ON u.id = ic.creator_id
     LEFT JOIN (
       SELECT w.owner_id AS creator_id, SUM(le.amount_santim) AS total
       FROM ledger_entries le
       JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id AND lt.type = 'ad'
       JOIN wallets w ON w.id = le.wallet_id AND w.owner_type = 'user'
       WHERE le.direction = 'credit'
       GROUP BY w.owner_id
     ) rev ON rev.creator_id = ic.creator_id
     ORDER BY rev.total DESC NULLS LAST`
  );
  return rows.map((row) => ({
    creatorId: row.creator_id,
    creatorUsername: row.username,
    impressionCount: Number(row.impression_count),
    totalSantim: Number(row.total ?? 0),
  }));
}
