import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { getPlatformWalletId, getUserWalletId } from "../common/ledger.js";
import { cleanupTestUsers, createTestCreator, createTestViewer } from "../test/fixtures.js";
import { getCreatorAnalytics } from "./analytics-service.js";

// No test file exercised creator-facing analytics before this pass (a
// real gap — this is the only creator-scoped read over
// stream_viewer_samples/stream_watch_time_daily/ledger_entries; the
// admin equivalent in admin/analytics-service.test.ts is platform-wide).

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

// Migration 0048's ledger balance enforcement requires every transaction's
// credits and debits to sum to zero — a lone credit row is rejected, so
// this debits the platform wallet for the same amount, same shape as a
// real gift/ad-revenue credit.
async function creditWallet(walletId: string, amountSantim: number, type: string): Promise<void> {
  const platformWalletId = await getPlatformWalletId(pool);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ledger_transactions (type, status) VALUES ($1, 'completed') RETURNING id`,
    [type]
  );
  createdLedgerTransactionIds.push(rows[0]!.id);
  await pool.query(
    `INSERT INTO ledger_entries (ledger_transaction_id, wallet_id, direction, amount_santim) VALUES
       ($1, $2, 'credit', $3), ($1, $4, 'debit', $3)`,
    [rows[0]!.id, walletId, amountSantim, platformWalletId]
  );
}

describe("getCreatorAnalytics", () => {
  it("returns one zero-filled day point per day in the window when there's no data at all", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    const result = await getCreatorAnalytics(creator.id, "7d");

    expect(result.days).toHaveLength(8); // inclusive of both endpoints, matching generate_series
    expect(result.days.every((d) => d.peakViewers === 0 && d.watchHours === 0)).toBe(true);
    expect(result.totals.totalWatchHours).toBe(0);
  });

  it("computes peak/avg viewers and watch-hours from real raw samples", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    // Two distinct samples "now" — the (stream_id, sampled_at) PK needs
    // distinct timestamps, and each row's own viewer_seconds contribution
    // is viewer_count * 60 regardless of the real gap between them.
    // 10 and 20 viewers -> peak 20, avg 15, viewer_seconds = 30*60 = 1800s = 0.5h.
    await pool.query(
      `INSERT INTO stream_viewer_samples (stream_id, sampled_at, viewer_count) VALUES
         ($1, now(), 10), ($1, now() + interval '1 second', 20)`,
      [creator.streamId]
    );

    const result = await getCreatorAnalytics(creator.id, "7d");

    expect(result.totals.peakViewers).toBe(20);
    expect(result.totals.totalWatchHours).toBe(0.5);
    const today = result.days[result.days.length - 1]!;
    expect(today.peakViewers).toBe(20);
    expect(today.avgViewers).toBe(15);
  });

  it("counts real follows gained and excludes another creator's followers", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    const otherCreator = await createTestCreator();
    createdUserIds.push(otherCreator.id);
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    const otherViewer = await createTestViewer();
    createdUserIds.push(otherViewer.id);

    await pool.query(`INSERT INTO follows (follower_id, creator_id) VALUES ($1, $2)`, [viewer.id, creator.id]);
    await pool.query(`INSERT INTO follows (follower_id, creator_id) VALUES ($1, $2)`, [
      otherViewer.id,
      otherCreator.id,
    ]);

    const result = await getCreatorAnalytics(creator.id, "7d");

    expect(result.totals.followsGained).toBe(1);
  });

  it("counts non-deleted chat messages on the creator's own streams only", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    await pool.query(
      `INSERT INTO chat_messages (stream_id, user_id, body, is_deleted) VALUES ($1, $2, 'hi', FALSE)`,
      [creator.streamId, viewer.id]
    );
    await pool.query(
      `INSERT INTO chat_messages (stream_id, user_id, body, is_deleted) VALUES ($1, $2, 'removed', TRUE)`,
      [creator.streamId, viewer.id]
    );

    const result = await getCreatorAnalytics(creator.id, "7d");

    const totalChat = result.days.reduce((sum, d) => sum + d.chatMessages, 0);
    expect(totalChat).toBe(1);
  });

  it("sums real ledger credits into totals and a per-type breakdown", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    const walletId = await getUserWalletId(pool, creator.id);

    await creditWallet(walletId, 500, "gift");
    await creditWallet(walletId, 300, "gift");
    await creditWallet(walletId, 1000, "ad");

    const result = await getCreatorAnalytics(creator.id, "7d");

    expect(result.totals.totalRevenueSantim).toBe(1800);
    expect(result.revenueByType).toEqual(
      expect.arrayContaining([
        { type: "gift", totalSantim: 800 },
        { type: "ad", totalSantim: 1000 },
      ])
    );
  });
});
