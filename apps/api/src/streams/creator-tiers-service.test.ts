import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { getPlatformWalletId, getUserWalletId } from "../common/ledger.js";
import { cleanupTestUsers, createTestCreator } from "../test/fixtures.js";
import { getCreatorTier, recomputeCreatorTiers } from "./creator-tiers-service.js";

// Defaults from db/migrations/0067_creator_tiers.sql: bronze needs >= 10
// watch-hours AND >= 5,000 santim gift volume; silver 50h/25,000 santim.

const createdUserIds: string[] = [];
const createdLedgerTransactionIds: string[] = [];

afterAll(async () => {
  await pool.query(`DELETE FROM ledger_entries WHERE ledger_transaction_id = ANY($1)`, [
    createdLedgerTransactionIds,
  ]);
  await pool.query(`DELETE FROM ledger_transactions WHERE id = ANY($1)`, [createdLedgerTransactionIds]);
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

async function seedWatchHours(streamId: string, hours: number): Promise<void> {
  const viewerCount = Math.round((hours * 3600) / 60); // one sample's viewer_seconds = viewer_count * 60
  await pool.query(`INSERT INTO stream_viewer_samples (stream_id, sampled_at, viewer_count) VALUES ($1, now(), $2)`, [
    streamId,
    viewerCount,
  ]);
}

async function seedGiftVolume(creatorId: string, amountSantim: number): Promise<void> {
  const walletId = await getUserWalletId(pool, creatorId);
  const platformWalletId = await getPlatformWalletId(pool);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ledger_transactions (type, status) VALUES ('gift', 'completed') RETURNING id`
  );
  createdLedgerTransactionIds.push(rows[0]!.id);
  await pool.query(
    `INSERT INTO ledger_entries (ledger_transaction_id, wallet_id, direction, amount_santim) VALUES
       ($1, $2, 'credit', $3), ($1, $4, 'debit', $3)`,
    [rows[0]!.id, walletId, amountSantim, platformWalletId]
  );
}

describe("getCreatorTier", () => {
  it("defaults to 'none' with bronze as the next target for a creator with no history", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    const result = await getCreatorTier(creator.id);

    expect(result.tier).toBe("none");
    expect(result.nextTier).toBe("bronze");
    expect(result.nextTierWatchHoursThreshold).toBe(10);
    expect(result.nextTierGiftVolumeSantimThreshold).toBe(5000);
    expect(result.isAnchorCreator).toBe(false);
  });
});

describe("recomputeCreatorTiers", () => {
  it("requires BOTH thresholds — clearing only watch-hours stays at 'none'", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    await seedWatchHours(creator.streamId, 20); // clears bronze's 10h
    // No gift volume at all — bronze's 5,000 santim isn't cleared.

    await recomputeCreatorTiers();

    expect((await getCreatorTier(creator.id)).tier).toBe("none");
  });

  it("reaches bronze once both thresholds are cleared, and reports silver as next", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    await seedWatchHours(creator.streamId, 15);
    await seedGiftVolume(creator.id, 6000);

    await recomputeCreatorTiers();
    const result = await getCreatorTier(creator.id);

    expect(result.tier).toBe("bronze");
    expect(result.nextTier).toBe("silver");
  });

  it("reaching partner sets creator_profiles.is_anchor_creator", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    await seedWatchHours(creator.streamId, 600);
    await seedGiftVolume(creator.id, 600_000);

    await recomputeCreatorTiers();
    const result = await getCreatorTier(creator.id);

    expect(result.tier).toBe("partner");
    expect(result.nextTier).toBeNull();
    expect(result.isAnchorCreator).toBe(true);
  });

  it("is idempotent — a second run without new activity leaves the tier unchanged", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    await seedWatchHours(creator.streamId, 15);
    await seedGiftVolume(creator.id, 6000);
    await recomputeCreatorTiers();

    await recomputeCreatorTiers();

    expect((await getCreatorTier(creator.id)).tier).toBe("bronze");
  });
});
