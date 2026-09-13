import { afterAll, describe, expect, it } from "vitest";
import { AppError } from "../common/errors.js";
import { pool } from "../common/db.js";
import {
  assertTransactionBalanced,
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getWalletBalance,
  type TestCreator,
} from "../test/fixtures.js";
import { createAdCreative, getPrerollBreak, recordAdCompletion, settleAdRevenue } from "./service.js";

// No test file exercised ad settlement before this pass (flagged in
// 2026-09-05's health audit) — it's a real gap, since settleAdRevenue()
// performs real insertEntry() ledger writes (a 3-leg split: platform
// debit, creator credit, platform credit) on every run.

const createdUserIds: string[] = [];
const createdAdvertiserIds: string[] = [];
const createdLedgerTransactionIds: string[] = [];

async function trackCreator(creator: TestCreator): Promise<TestCreator> {
  createdUserIds.push(creator.id);
  return creator;
}

async function insertAdvertiser(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO advertisers (name) VALUES ('Test Advertiser') RETURNING id`
  );
  createdAdvertiserIds.push(rows[0]!.id);
  return rows[0]!.id;
}

async function insertCampaign(advertiserId: string, cpmSantim: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ad_campaigns (advertiser_id, name, budget_santim, cpm_santim, starts_at, ends_at, status)
     VALUES ($1, 'Test Campaign', 10_000_000, $2, now() - interval '1 day', now() + interval '30 days', 'active')
     RETURNING id`,
    [advertiserId, cpmSantim]
  );
  return rows[0]!.id;
}

async function insertCreative(campaignId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ad_creatives (campaign_id, format, asset_url, approved)
     VALUES ($1, 'display_banner', 'https://example.com/ad.png', TRUE) RETURNING id`,
    [campaignId]
  );
  return rows[0]!.id;
}

async function insertUnsettledImpressions(creativeId: string, creatorId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await pool.query(
      `INSERT INTO ad_impressions (creative_id, stream_id, creator_id, viewer_id) VALUES ($1, NULL, $2, NULL)`,
      [creativeId, creatorId]
    );
  }
}

async function insertPrerollCreative(
  campaignId: string,
  slot: "slot1" | "slot2",
  durationSeconds: number
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ad_creatives (campaign_id, format, asset_url, duration_seconds, preroll_slot, approved)
     VALUES ($1, 'preroll', 'https://example.com/ad.mp4', $2, $3, TRUE) RETURNING id`,
    [campaignId, durationSeconds, slot]
  );
  return rows[0]!.id;
}

async function enableAds(creatorId: string): Promise<void> {
  await pool.query(`UPDATE creator_profiles SET ads_enabled = TRUE WHERE user_id = $1`, [creatorId]);
}

// platform_subscriptions.ledger_transaction_id has no default/stub value —
// a real row is the cheapest way to satisfy the FK without pulling in the
// whole subscribe() flow this test doesn't otherwise exercise.
async function insertActivePlatformSubscription(viewerId: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ledger_transactions (type, status) VALUES ('platform_subscription', 'completed') RETURNING id`
  );
  createdLedgerTransactionIds.push(rows[0]!.id);
  await pool.query(
    `INSERT INTO platform_subscriptions (ledger_transaction_id, subscriber_id, amount_santim, expires_at)
     VALUES ($1, $2, 15000, now() + interval '30 days')`,
    [rows[0]!.id, viewerId]
  );
}

// getPrerollBreak's eligibility query has no per-test scoping (a creative
// with no ad_targeting row is eligible for ANY stream) — unlike the
// settleAdRevenue tests above (format='display_banner', never matched by
// getPrerollBreak's format='preroll' filter), these tests WOULD leak
// approved preroll creatives into each other without this, since they all
// share the same eligibility pool. Deletes impressions first since
// ad_impressions.creative_id has no ON DELETE CASCADE from ad_creatives.
async function cleanupPrerollFixture(campaignId: string, advertiserId: string): Promise<void> {
  await pool.query(`DELETE FROM ad_impressions WHERE creative_id IN (SELECT id FROM ad_creatives WHERE campaign_id = $1)`, [
    campaignId,
  ]);
  await pool.query(`DELETE FROM ad_campaigns WHERE id = $1`, [campaignId]); // cascades to ad_creatives
  await pool.query(`DELETE FROM advertisers WHERE id = $1`, [advertiserId]);
}

async function getSettledCount(creatorId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM ad_impressions WHERE creator_id = $1 AND settled = TRUE`,
    [creatorId]
  );
  return Number(rows[0]!.count);
}

afterAll(async () => {
  // ad_impressions.creator_id has no ON DELETE CASCADE from users
  // (0020_ads.sql) — must be cleared before cleanupTestUsers's own DELETE
  // FROM users, and its settled_ledger_transaction_id rows aren't
  // reachable by cleanupTestUsers's own ledger-transaction collection
  // query either (it only looks at gifts_sent/payouts/streams), so this
  // file cleans its own ledger rows directly, before calling
  // cleanupTestUsers — whose platform-wallet reconciliation step at the
  // end then correctly recomputes the cache from whatever ledger_entries
  // are left once this test's own are gone.
  const { rows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT settled_ledger_transaction_id AS id FROM ad_impressions
     WHERE creator_id = ANY($1) AND settled_ledger_transaction_id IS NOT NULL`,
    [createdUserIds]
  );
  await pool.query(`DELETE FROM ad_impressions WHERE creator_id = ANY($1)`, [createdUserIds]);
  const ledgerTransactionIds = rows.map((r) => r.id);
  await pool.query(`DELETE FROM ledger_entries WHERE ledger_transaction_id = ANY($1)`, [ledgerTransactionIds]);
  await pool.query(`DELETE FROM ledger_transactions WHERE id = ANY($1)`, [ledgerTransactionIds]);
  await pool.query(`DELETE FROM ad_campaigns WHERE advertiser_id = ANY($1)`, [createdAdvertiserIds]);
  await pool.query(`DELETE FROM advertisers WHERE id = ANY($1)`, [createdAdvertiserIds]);
  await cleanupTestUsers(createdUserIds);
  // cleanupTestUsers deletes the platform_subscriptions row itself but
  // leaves its ledger_transaction_id row behind (nothing else references
  // it once that row is gone) — cleaned up here since this file created it.
  await pool.query(`DELETE FROM ledger_transactions WHERE id = ANY($1)`, [createdLedgerTransactionIds]);
  await pool.end();
});

describe("settleAdRevenue", () => {
  it("splits revenue by ad_revenue_share_bps (55% creator / 45% platform by default) and marks impressions settled", async () => {
    const creator = await trackCreator(await createTestCreator());
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000); // 10 santim/impression
    const creativeId = await insertCreative(campaignId);
    await insertUnsettledImpressions(creativeId, creator.id, 20); // 20 * 10 = 200 santim total

    const platformWalletBefore = await getPlatformWalletBalance();

    await settleAdRevenue();

    expect(await getWalletBalance(creator.walletId)).toBe(110); // trunc(200 * 5500 / 10000)
    expect(await getPlatformWalletBalance()).toBe(platformWalletBefore - 110); // -200 + 90
    expect(await getSettledCount(creator.id)).toBe(20);

    const { rows } = await pool.query<{ settled_ledger_transaction_id: string }>(
      `SELECT DISTINCT settled_ledger_transaction_id FROM ad_impressions WHERE creator_id = $1`,
      [creator.id]
    );
    expect(rows).toHaveLength(1);
    await assertTransactionBalanced(rows[0]!.settled_ledger_transaction_id);
  });

  it("marks impressions settled without creating a ledger transaction when the CPM truncates to 0/impression", async () => {
    const creator = await trackCreator(await createTestCreator());
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 500); // floor(500/1000) = 0/impression
    const creativeId = await insertCreative(campaignId);
    await insertUnsettledImpressions(creativeId, creator.id, 5);

    const balanceBefore = await getWalletBalance(creator.walletId);

    await settleAdRevenue();

    expect(await getWalletBalance(creator.walletId)).toBe(balanceBefore); // unchanged — nothing billable
    expect(await getSettledCount(creator.id)).toBe(5);
    const { rows } = await pool.query(
      `SELECT settled_ledger_transaction_id FROM ad_impressions WHERE creator_id = $1`,
      [creator.id]
    );
    expect(rows.every((r) => r.settled_ledger_transaction_id === null)).toBe(true);
  });

  it("is idempotent — a second run finds nothing left to settle and does not double-charge", async () => {
    const creator = await trackCreator(await createTestCreator());
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);
    const creativeId = await insertCreative(campaignId);
    await insertUnsettledImpressions(creativeId, creator.id, 10); // 100 santim total

    await settleAdRevenue();
    const balanceAfterFirstRun = await getWalletBalance(creator.walletId);

    await settleAdRevenue(); // nothing unsettled remains

    expect(await getWalletBalance(creator.walletId)).toBe(balanceAfterFirstRun);
  });

  it("processes each creator's unsettled impressions independently in the same run", async () => {
    const creatorA = await trackCreator(await createTestCreator());
    const creatorB = await trackCreator(await createTestCreator());
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);
    const creativeId = await insertCreative(campaignId);
    await insertUnsettledImpressions(creativeId, creatorA.id, 10); // 100 santim
    await insertUnsettledImpressions(creativeId, creatorB.id, 30); // 300 santim

    await settleAdRevenue();

    expect(await getWalletBalance(creatorA.walletId)).toBe(55); // trunc(100 * 0.55)
    expect(await getWalletBalance(creatorB.walletId)).toBe(165); // trunc(300 * 0.55)
  });
});

describe("getPrerollBreak", () => {
  it("returns null/null when the creator has ads disabled", async () => {
    const creator = await trackCreator(await createTestCreator()); // ads_enabled defaults to FALSE
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);
    try {
      await insertPrerollCreative(campaignId, "slot1", 30);
      await insertPrerollCreative(campaignId, "slot2", 15);

      expect(await getPrerollBreak(creator.streamId, null)).toEqual({ slot1: null, slot2: null });
    } finally {
      await cleanupPrerollFixture(campaignId, advertiserId);
    }
  });

  it("returns null/null for a viewer with an active platform-wide subscription", async () => {
    const creator = await trackCreator(await createTestCreator());
    await enableAds(creator.id);
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    await insertActivePlatformSubscription(viewer.id);
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);
    try {
      await insertPrerollCreative(campaignId, "slot1", 30);

      expect(await getPrerollBreak(creator.streamId, viewer.id)).toEqual({ slot1: null, slot2: null });
    } finally {
      await cleanupPrerollFixture(campaignId, advertiserId);
    }
  });

  it("serves a mandatory slot1 and a skippable slot2 from distinct creatives when both are eligible", async () => {
    const creator = await trackCreator(await createTestCreator());
    await enableAds(creator.id);
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);
    try {
      const slot1Id = await insertPrerollCreative(campaignId, "slot1", 30);
      const slot2Id = await insertPrerollCreative(campaignId, "slot2", 15);

      const result = await getPrerollBreak(creator.streamId, null);

      expect(result.slot1).not.toBeNull();
      expect(result.slot1!.skippableAfterSeconds).toBeNull();
      expect(result.slot1!.durationSeconds).toBe(30);

      expect(result.slot2).not.toBeNull();
      expect(result.slot2!.skippableAfterSeconds).toBe(5); // platform_config.preroll_slot2_skip_after_seconds default
      expect(result.slot2!.durationSeconds).toBe(15);

      // Two distinct impressions were actually inserted, one per served slot.
      const { rows } = await pool.query<{ creative_id: string }>(
        `SELECT creative_id FROM ad_impressions WHERE id = ANY($1)`,
        [[result.slot1!.impressionId, result.slot2!.impressionId]]
      );
      expect(rows.map((r) => r.creative_id).sort()).toEqual([slot1Id, slot2Id].sort());
    } finally {
      await cleanupPrerollFixture(campaignId, advertiserId);
    }
  });

  it("returns a null slot2 when only a slot1 creative is eligible", async () => {
    const creator = await trackCreator(await createTestCreator());
    await enableAds(creator.id);
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);
    try {
      await insertPrerollCreative(campaignId, "slot1", 30);

      const result = await getPrerollBreak(creator.streamId, null);

      expect(result.slot1).not.toBeNull();
      expect(result.slot2).toBeNull();
    } finally {
      await cleanupPrerollFixture(campaignId, advertiserId);
    }
  });

  it("returns none once the viewer's slot1 frequency cap is reached, even though the creative would otherwise be eligible", async () => {
    const creator = await trackCreator(await createTestCreator());
    await enableAds(creator.id);
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);
    try {
      const slot1Id = await insertPrerollCreative(campaignId, "slot1", 30);

      // platform_config.ad_frequency_cap_per_hour defaults to 3 — three
      // prior impressions for this exact viewer+creative pair within the
      // last hour is enough to exclude it from being picked again.
      for (let i = 0; i < 3; i++) {
        await pool.query(
          `INSERT INTO ad_impressions (creative_id, stream_id, creator_id, viewer_id) VALUES ($1, $2, $3, $4)`,
          [slot1Id, creator.streamId, creator.id, viewer.id]
        );
      }

      expect(await getPrerollBreak(creator.streamId, viewer.id)).toEqual({ slot1: null, slot2: null });
    } finally {
      await cleanupPrerollFixture(campaignId, advertiserId);
    }
  });
});

describe("createAdCreative — preroll slot validation", () => {
  it("rejects a slot1 creative whose duration doesn't match the configured mandatory length", async () => {
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);

    await expect(
      createAdCreative("00000000-0000-0000-0000-000000000000", {
        campaignId,
        format: "preroll",
        assetUrl: "https://example.com/ad.mp4",
        durationSeconds: 25, // platform_config default is 30
        prerollSlot: "slot1",
      })
    ).rejects.toThrow(/exactly 30s/);
  });

  it("rejects a slot2 creative shorter than the configured skip-after duration", async () => {
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);

    await expect(
      createAdCreative("00000000-0000-0000-0000-000000000000", {
        campaignId,
        format: "preroll",
        assetUrl: "https://example.com/ad.mp4",
        durationSeconds: 3, // platform_config default skip-after is 5
        prerollSlot: "slot2",
      })
    ).rejects.toThrow(/at least 5s/);
  });

  it("accepts a valid slot1 creative and returns zeroed analytics fields", async () => {
    const admin = await createTestViewer(); // just needs to satisfy admin_actions' actor_id FK
    createdUserIds.push(admin.id);
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);

    const result = await createAdCreative(admin.id, {
      campaignId,
      format: "preroll",
      assetUrl: "https://example.com/ad.mp4",
      durationSeconds: 30,
      prerollSlot: "slot1",
    });

    expect(result.prerollSlot).toBe("slot1");
    expect(result.impressionCount).toBe(0);
    expect(result.clickCount).toBe(0);
    expect(result.completionRate).toBeNull();
    expect(result.skipRate).toBeNull();
  });
});

describe("recordAdCompletion", () => {
  it("updates completed_seconds and skipped on the correct impression", async () => {
    const creator = await trackCreator(await createTestCreator());
    const advertiserId = await insertAdvertiser();
    const campaignId = await insertCampaign(advertiserId, 10_000);
    const creativeId = await insertCreative(campaignId);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO ad_impressions (creative_id, stream_id, creator_id, viewer_id) VALUES ($1, NULL, $2, NULL) RETURNING id`,
      [creativeId, creator.id]
    );
    const impressionId = rows[0]!.id;

    await recordAdCompletion(impressionId, { completedSeconds: 12, skipped: true });

    const { rows: after } = await pool.query<{ completed_seconds: number; skipped: boolean }>(
      `SELECT completed_seconds, skipped FROM ad_impressions WHERE id = $1`,
      [impressionId]
    );
    expect(after[0]!.completed_seconds).toBe(12);
    expect(after[0]!.skipped).toBe(true);
  });

  it("404s for an unknown impression id", async () => {
    await expect(
      recordAdCompletion("00000000-0000-0000-0000-000000000000", { completedSeconds: 5, skipped: false })
    ).rejects.toThrow(AppError);
  });
});

async function getPlatformWalletBalance(): Promise<number> {
  const { rows } = await pool.query<{ balance_santim: number }>(
    `SELECT balance_santim FROM wallet_balances_cache
     WHERE wallet_id = (SELECT id FROM wallets WHERE owner_type = 'platform' AND currency = 'ETB')`
  );
  return rows[0]!.balance_santim;
}
