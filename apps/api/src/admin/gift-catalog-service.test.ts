import { afterAll, afterEach, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import {
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getGiftTypeId,
  type TestUser,
} from "../test/fixtures.js";
import { performManualAdjustment } from "./ledger-service.js";
import { updateCreator } from "./creators-service.js";
import { listGiftTypes, sendGift } from "../wallet/service.js";
import { listGiftTypesForAdmin, updateGiftType } from "./gift-catalog-service.js";

const createdUserIds: string[] = [];
const restoreGiftTypeIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function getGiftTypeRow(id: string) {
  const { rows } = await pool.query<{
    is_active: boolean;
    category: string;
    creator_share_bps: number;
    available_from: string | null;
    available_until: string | null;
    regions: string[] | null;
  }>(
    `SELECT is_active, category, creator_share_bps, available_from, available_until, regions
     FROM gift_types WHERE id = $1`,
    [id]
  );
  return rows[0]!;
}

// T3's acceptance criteria touch shared, non-test-owned gift_types rows
// (the real catalog seed) — every test that mutates one restores its
// exact original state afterward, rather than leaning on cleanupTestUsers
// (which is keyed by user id, not gift type id).
afterEach(async () => {
  for (const id of restoreGiftTypeIds.splice(0)) {
    await pool.query(
      `UPDATE gift_types SET is_active = TRUE, category = 'classic', creator_share_bps = 5000,
         available_from = NULL, available_until = NULL, regions = NULL
       WHERE id = $1`,
      [id]
    );
  }
});

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("listGiftTypesForAdmin", () => {
  it("includes inactive and out-of-window gifts, unlike the viewer-facing catalog", async () => {
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    restoreGiftTypeIds.push(giftTypeId);
    await pool.query(`UPDATE gift_types SET is_active = FALSE WHERE id = $1`, [giftTypeId]);

    const adminList = await listGiftTypesForAdmin();
    expect(adminList.find((g) => g.id === giftTypeId)?.isActive).toBe(false);

    const viewerList = await listGiftTypes();
    expect(viewerList.find((g) => g.id === giftTypeId)).toBeUndefined();
  });
});

describe("updateGiftType", () => {
  it("updates fields, writes an admin_actions row with reason and before/after, and does not touch unrelated fields", async () => {
    const giftTypeId = await getGiftTypeId("Golden Mulmul");
    restoreGiftTypeIds.push(giftTypeId);
    const admin = await trackUser(await createTestViewer());
    const before = await getGiftTypeRow(giftTypeId);

    const result = await updateGiftType(admin.id, giftTypeId, {
      category: "seasonal",
      creatorShareBps: 6000,
      reason: "finance requested a seasonal re-categorization",
    });

    expect(result.category).toBe("seasonal");
    expect(result.creatorShareBps).toBe(6000);
    // is_active untouched by an update that didn't mention it.
    expect(result.isActive).toBe(before.is_active);

    const { rows } = await pool.query<{ reason: string; before_state: unknown; after_state: unknown }>(
      `SELECT reason, before_state, after_state FROM admin_actions
       WHERE action = 'gift_type.update' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [giftTypeId]
    );
    expect(rows[0]!.reason).toBe("finance requested a seasonal re-categorization");
    expect((rows[0]!.before_state as { category: string }).category).toBe("classic");
    expect((rows[0]!.after_state as { category: string }).category).toBe("seasonal");
  });

  it("clears an availability bound via an explicit null, and leaves it alone when omitted", async () => {
    const giftTypeId = await getGiftTypeId("Golden Mulmul");
    restoreGiftTypeIds.push(giftTypeId);
    const admin = await trackUser(await createTestViewer());
    const future = new Date(Date.now() + 60_000).toISOString();

    await updateGiftType(admin.id, giftTypeId, { availableUntil: future, reason: "schedule a window" });
    expect((await getGiftTypeRow(giftTypeId)).available_until).not.toBeNull();

    // Omitted — leaves availableUntil as it was.
    await updateGiftType(admin.id, giftTypeId, { category: "seasonal", reason: "unrelated change" });
    expect((await getGiftTypeRow(giftTypeId)).available_until).not.toBeNull();

    // Explicit null — clears it.
    await updateGiftType(admin.id, giftTypeId, { availableUntil: null, reason: "remove the window" });
    expect((await getGiftTypeRow(giftTypeId)).available_until).toBeNull();
  });

  it("404s for an unknown gift type id", async () => {
    const admin = await trackUser(await createTestViewer());
    await expect(
      updateGiftType(admin.id, "00000000-0000-0000-0000-000000000000", { reason: "x" })
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("availability window — enforced on both the catalog listing and the send path", () => {
  it("a gift outside its availability window does not appear in the client catalog and cannot be sent", async () => {
    const giftTypeId = await getGiftTypeId("Golden Mulmul");
    restoreGiftTypeIds.push(giftTypeId);
    const admin = await trackUser(await createTestViewer());
    await updateGiftType(admin.id, giftTypeId, {
      availableUntil: new Date(Date.now() - 60_000).toISOString(), // already expired
      reason: "test: expire this gift",
    });

    expect((await listGiftTypes()).find((g) => g.id === giftTypeId)).toBeUndefined();

    const creator = await trackUser(await createTestCreator());
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 100_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });

    await expect(
      sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 })
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("gifts_sent.creator_share_bps pins the historical rate", () => {
  it("records the creator's revenue_share_bps at send time, and a later rate change never rewrites it", async () => {
    const creator = await trackUser(await createTestCreator(7000)); // 70% at creation
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    const admin = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 100_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const giftTypeId = await getGiftTypeId("Classic Mulmul");

    const { id: ledgerTransactionId } = await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });
    const { rows: sentRows } = await pool.query<{ creator_share_bps: number }>(
      `SELECT creator_share_bps FROM gifts_sent WHERE ledger_transaction_id = $1`,
      [ledgerTransactionId]
    );
    expect(sentRows[0]!.creator_share_bps).toBe(7000);

    // Admin changes the creator's real rate going forward.
    await updateCreator(admin.id, creator.id, { revenueShareBps: 3000 });

    // The historical row is untouched.
    const { rows: afterRateChange } = await pool.query<{ creator_share_bps: number }>(
      `SELECT creator_share_bps FROM gifts_sent WHERE ledger_transaction_id = $1`,
      [ledgerTransactionId]
    );
    expect(afterRateChange[0]!.creator_share_bps).toBe(7000);

    // A new gift after the change pins the new rate.
    const { id: secondTxId } = await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });
    const { rows: secondRow } = await pool.query<{ creator_share_bps: number }>(
      `SELECT creator_share_bps FROM gifts_sent WHERE ledger_transaction_id = $1`,
      [secondTxId]
    );
    expect(secondRow[0]!.creator_share_bps).toBe(3000);
  });

  it("gift_types.creator_share_bps is a reference value only — changing it never changes the real split", async () => {
    const creator = await trackUser(await createTestCreator(8000)); // creator's real, negotiated rate
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 100_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    restoreGiftTypeIds.push(giftTypeId);
    const admin = await trackUser(await createTestViewer());
    // Set the catalog's reference rate to something wildly different from
    // the creator's real rate.
    await updateGiftType(admin.id, giftTypeId, { creatorShareBps: 1000, reason: "test: reference rate only" });

    const { id: ledgerTransactionId } = await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    const { rows } = await pool.query<{ creator_share_bps: number }>(
      `SELECT creator_share_bps FROM gifts_sent WHERE ledger_transaction_id = $1`,
      [ledgerTransactionId]
    );
    // Pinned rate is the creator's real 8000, not the catalog's 1000.
    expect(rows[0]!.creator_share_bps).toBe(8000);
  });
});
