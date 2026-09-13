import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { performManualAdjustment } from "./ledger-service.js";
import {
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getGiftTypeId,
  type TestUser,
} from "../test/fixtures.js";
import { completeTopupFromWebhook, initiateTopup, sendGift } from "../wallet/service.js";
import { recomputeRevenueDailyForDay, recomputeTrailingRevenueDays } from "./revenue-daily-service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

// Fetched from Postgres, not approximated with a UTC-based JS Date — a
// test running close to UTC midnight would otherwise pick the wrong
// calendar day relative to Africa/Addis_Ababa (UTC+3), the same footgun
// documented at the top of leaderboard-service.ts.
async function addisToday(): Promise<string> {
  const { rows } = await pool.query<{ today: string }>(
    `SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date::text AS today`
  );
  return rows[0]!.today;
}

async function getRevenueDailyRow(day: string) {
  const { rows } = await pool.query<{
    gross_santim: string;
    refunds_santim: string;
    chargebacks_santim: string;
    creator_share_santim: string;
    promo_issued_santim: string;
    net_santim: string;
    paying_users: number;
    active_users: number;
    active_streamers: number;
  }>(
    `SELECT gross_santim::text, refunds_santim::text, chargebacks_santim::text, creator_share_santim::text,
            promo_issued_santim::text, net_santim::text, paying_users, active_users, active_streamers
     FROM revenue_daily WHERE day = $1::date`,
    [day]
  );
  return rows[0];
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("recomputeRevenueDailyForDay", () => {
  it("computes gross from topups, creator_share from revenue types, and a net_santim consistent with the generated column", async () => {
    const viewer = await trackUser(await createTestViewer());
    const creator = await trackUser(await createTestCreator(8000));
    const { reference } = await initiateTopup(viewer.id, 50_000);
    await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: 50_000, currency: "ETB" });
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    const today = await addisToday();
    await recomputeRevenueDailyForDay(today);
    const row = await getRevenueDailyRow(today);

    expect(row).toBeDefined();
    expect(Number(row!.gross_santim)).toBeGreaterThanOrEqual(50_000);
    expect(Number(row!.creator_share_santim)).toBeGreaterThan(0);
    expect(Number(row!.refunds_santim)).toBe(0);
    expect(Number(row!.chargebacks_santim)).toBe(0);
    expect(Number(row!.net_santim)).toBe(
      Number(row!.gross_santim) - Number(row!.refunds_santim) - Number(row!.chargebacks_santim) - Number(row!.creator_share_santim)
    );
  });

  it("promo_issued_santim counts only promotional-bucket credits", async () => {
    const viewer = await trackUser(await createTestViewer());
    const admin = await trackUser(await createTestViewer());
    await performManualAdjustment(admin.id, {
      targetUsername: viewer.username,
      amountSantim: 12_345,
      direction: "credit_user",
      reason: "test promo grant",
      fundingBucket: "promotional",
    });

    const today = await addisToday();
    await recomputeRevenueDailyForDay(today);
    const row = await getRevenueDailyRow(today);

    expect(Number(row!.promo_issued_santim)).toBeGreaterThanOrEqual(12_345);
  });

  it("is idempotent — recomputing the same day twice with no new data gives the same row", async () => {
    const viewer = await trackUser(await createTestViewer());
    const { reference } = await initiateTopup(viewer.id, 7_000);
    await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: 7_000, currency: "ETB" });

    const today = await addisToday();
    await recomputeRevenueDailyForDay(today);
    const first = await getRevenueDailyRow(today);
    await recomputeRevenueDailyForDay(today);
    const second = await getRevenueDailyRow(today);

    expect(second).toEqual(first);
  });
});

describe("recomputeTrailingRevenueDays", () => {
  it("populates a row for today among the trailing window without error", async () => {
    const viewer = await trackUser(await createTestViewer());
    const { reference } = await initiateTopup(viewer.id, 1_000);
    await completeTopupFromWebhook({ tx_ref: reference, status: "success", amount: 1_000, currency: "ETB" });

    await expect(recomputeTrailingRevenueDays(5)).resolves.toBeUndefined();

    const row = await getRevenueDailyRow(await addisToday());
    expect(row).toBeDefined();
    expect(Number(row!.gross_santim)).toBeGreaterThanOrEqual(1_000);
  });
});
