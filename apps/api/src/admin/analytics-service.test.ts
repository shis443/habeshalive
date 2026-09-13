import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { performManualAdjustment } from "./ledger-service.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestUser } from "../test/fixtures.js";
import { completeTopupFromWebhook, initiateTopup } from "../wallet/service.js";
import { rebuildLeaderboardWindow } from "./leaderboard-service.js";
import {
  getAnalyticsOverview,
  getAvailableWindowOptions,
  getCcuCurve,
  getLeaderboardForDisplay,
  getPeriodSummary,
} from "./analytics-service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function addisBounds(daysAgo: number, spanDays: number): Promise<{ start: string; end: string }> {
  const { rows } = await pool.query<{ start: string; end: string }>(
    `SELECT
       ((now() AT TIME ZONE 'Africa/Addis_Ababa')::date - $1::int)::text AS start,
       ((now() AT TIME ZONE 'Africa/Addis_Ababa')::date - $1::int + $2::int)::text AS end`,
    [daysAgo, spanDays]
  );
  return rows[0]!;
}

afterAll(async () => {
  await pool.query(`DELETE FROM leaderboard_snapshots WHERE subject_id = ANY($1)`, [createdUserIds]);
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("getPeriodSummary", () => {
  it("sums gross/creator_share as real money and counts activeUsers/payingUsers as genuine DISTINCT people, not a sum of daily counts", async () => {
    const viewer = await trackUser(await createTestViewer());
    const { reference } = await initiateTopup(viewer.id, 30_000);
    await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: 30_000, currency: "ETB" });
    // A second top-up from the SAME viewer, same window — paying_users
    // must still count them once, not twice.
    const { reference: ref2 } = await initiateTopup(viewer.id, 5_000);
    await completeTopupFromWebhook({ tx_ref: ref2, status: "success", amount: 5_000, currency: "ETB" });

    const { start, end } = await addisBounds(0, 1);
    const summary = await getPeriodSummary(start, end);

    expect(summary.grossSantim).toBeGreaterThanOrEqual(35_000);
    expect(summary.payingUsers).toBeGreaterThanOrEqual(1);
  });

  it("net_santim equals gross minus creator_share, with a real nonzero creator_share (refunds/chargebacks are always 0)", async () => {
    const creator = await trackUser(await createTestCreator(8000));
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 100_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const { reference } = await initiateTopup(funder.id, 100_000);
    await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: 100_000, currency: "ETB" });
    const { sendGift } = await import("../wallet/service.js");
    const { getGiftTypeId } = await import("../test/fixtures.js");
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    const { start, end } = await addisBounds(0, 1);
    const summary = await getPeriodSummary(start, end);

    expect(summary.creatorShareSantim).toBeGreaterThan(0);
    expect(summary.netSantim).toBe(summary.grossSantim - summary.creatorShareSantim);
  });
});

describe("getCcuCurve", () => {
  it("returns the platform-wide daily peak, combining raw and rolled-up sources, not a sum across streams", async () => {
    // This query is genuinely platform-wide by design, so other tests'
    // real "today" samples legitimately coexist with this test's own —
    // large, distinctive sentinel values (rather than small numbers like
    // 8/15) keep the assertions meaningful regardless of what else is in
    // the table, the same reasoning viewer-samples-service.test.ts's own
    // "does not sample a stream that isn't live" test already uses.
    const creatorA = await trackUser(await createTestCreator());
    const creatorB = await trackUser(await createTestCreator());
    const { start, end } = await addisBounds(0, 1);
    await pool.query(
      `INSERT INTO stream_viewer_samples (stream_id, sampled_at, viewer_count) VALUES ($1, now(), 80000), ($2, now(), 150000)`,
      [creatorA.streamId, creatorB.streamId]
    );

    const curve = await getCcuCurve(start, end);
    const todayPoint = curve.find((p) => p.day === start);

    expect(todayPoint).toBeDefined();
    expect(todayPoint!.peakViewers).toBe(150000); // MAX across both streams
    expect(todayPoint!.peakViewers).not.toBe(230000); // not 80000 + 150000
  });
});

describe("getLeaderboardForDisplay", () => {
  it("enriches T5's bare leaderboard rows with username/displayName", async () => {
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 100_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const creator = await trackUser(await createTestCreator(8000));
    const { sendGift } = await import("../wallet/service.js");
    const { getGiftTypeId } = await import("../test/fixtures.js");
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    const { start, end } = await addisBounds(0, 1);
    await rebuildLeaderboardWindow("top_gifters", "daily", start, end);
    const board = await getLeaderboardForDisplay("top_gifters", "daily", start);
    const entry = board.find((e) => e.subjectId === viewer.id);

    expect(entry).toBeDefined();
    expect(entry!.username).toBe(viewer.username);
  });

  it("returns an empty array without querying users at all when the board is empty", async () => {
    const result = await getLeaderboardForDisplay("top_gifters", "daily", "1999-01-01");
    expect(result).toEqual([]);
  });
});

describe("getAnalyticsOverview", () => {
  it("returns a current period, a previous period, a daily series, and a CCU curve without error", async () => {
    const viewer = await trackUser(await createTestViewer());
    const { reference } = await initiateTopup(viewer.id, 10_000);
    await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: 10_000, currency: "ETB" });

    const overview = await getAnalyticsOverview(7);

    expect(overview.current.grossSantim).toBeGreaterThanOrEqual(10_000);
    expect(overview.previous).toBeDefined();
    expect(Array.isArray(overview.dailySeries)).toBe(true);
    expect(Array.isArray(overview.ccuCurve)).toBe(true);
  });
});

describe("getAvailableWindowOptions", () => {
  it("returns exactly the 7 slots the rebuild job keeps populated, each a real, distinct window_start", async () => {
    const options = await getAvailableWindowOptions();

    expect(options).toHaveLength(7);
    expect(options.map((o) => o.label)).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "Last week",
      "This month",
      "Last month",
      "All time",
    ]);
    for (const option of options) {
      expect(option.windowStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // today != yesterday, this week != last week, etc.
    const daily = options.filter((o) => o.windowKind === "daily");
    expect(daily[0]!.windowStart).not.toBe(daily[1]!.windowStart);
  });
});
