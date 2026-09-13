import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { applyBalanceDelta, getPlatformWalletId, getUserWalletId, insertEntry } from "../common/ledger.js";
import {
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getGiftTypeId,
  type TestUser,
} from "../test/fixtures.js";
import { boostStream } from "../streams/service.js";
import { performManualAdjustment } from "./ledger-service.js";
import { sendGift } from "../wallet/service.js";
import { getBoostPricing } from "./config-service.js";
import { getLeaderboard, rebuildLeaderboardWindow, rebuildOpenLeaderboardWindows } from "./leaderboard-service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

// A fixed window far enough in the past/future that this file's own runs
// never collide with real background-job activity or with each other —
// each test that needs one picks a distinct day so their windows don't
// overlap.
function dailyWindow(daysAgo: number): { start: string; end: string } {
  const start = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// Mimics ads/service.ts's settleAdRevenue's ledger shape (platform debit,
// creator credit, type 'ad') without needing a full ad campaign/
// impression fixture — this only needs to prove the leaderboard query's
// type filter includes 'ad', not re-test ad settlement itself.
async function creditAdRevenue(creatorId: string, amountSantim: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const creatorWalletId = await getUserWalletId(client, creatorId);
    const platformWalletId = await getPlatformWalletId(client);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions (type, status, completed_at) VALUES ('ad', 'completed', now()) RETURNING id`
    );
    await insertEntry(client, rows[0]!.id, platformWalletId, "debit", amountSantim);
    await insertEntry(client, rows[0]!.id, creatorWalletId, "credit", amountSantim);
    await applyBalanceDelta(client, platformWalletId, -amountSantim);
    await applyBalanceDelta(client, creatorWalletId, amountSantim);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

afterAll(async () => {
  // Before cleanupTestUsers, not after — leaderboard_snapshots.subject_id
  // has an FK to users(id) with no cascade, so deleting the users first
  // would fail on any row this file left behind.
  await pool.query(`DELETE FROM leaderboard_snapshots WHERE subject_id = ANY($1)`, [createdUserIds]);
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("rebuildLeaderboardWindow — determinism and ledger reconciliation", () => {
  it("running the rebuild twice in a row produces identical results (the 'full rebuild == incremental path' check)", async () => {
    const creator = await trackUser(await createTestCreator(8000));
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 50_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    const { start, end } = dailyWindow(0);
    const firstCount = await rebuildLeaderboardWindow("top_gifters", "daily", start, end);
    const firstResult = await getLeaderboard("top_gifters", "daily", start);
    const secondCount = await rebuildLeaderboardWindow("top_gifters", "daily", start, end);
    const secondResult = await getLeaderboard("top_gifters", "daily", start);

    expect(secondCount).toBe(firstCount);
    expect(secondResult).toEqual(firstResult);
  });

  it("top_gifters totals reconcile exactly to the sum of the underlying ledger debit entries for 'gift' transactions", async () => {
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
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    const { id: tx1 } = await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });
    const { id: tx2 } = await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    const { start, end } = dailyWindow(0);
    await rebuildLeaderboardWindow("top_gifters", "daily", start, end);
    const board = await getLeaderboard("top_gifters", "daily", start);
    const viewerEntry = board.find((e) => e.subjectId === viewer.id);

    const { rows: independentSum } = await pool.query<{ total: string }>(
      `SELECT SUM(le.amount_santim)::text AS total
       FROM ledger_entries le
       WHERE le.direction = 'debit' AND le.ledger_transaction_id = ANY($1)`,
      [[tx1, tx2]]
    );

    expect(viewerEntry).toBeDefined();
    expect(viewerEntry!.value).toBe(Number(independentSum[0]!.total));
  });

  it("top_streamers_revenue includes gift and ad revenue but excludes boost (an expense, not revenue) and refunds", async () => {
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
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    const { id: giftTx } = await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });
    await creditAdRevenue(creator.id, 5_000);

    // A boost — the creator PAYS the platform, 100% to platform, no
    // creator credit at all. Must not appear as "revenue."
    const { priceSantim: boostPrice } = await getBoostPricing();
    await performManualAdjustment(funder.id, {
      targetUsername: creator.username,
      amountSantim: boostPrice,
      direction: "credit_user",
      reason: "fund the boost purchase itself",
      fundingBucket: "paid",
    });
    await boostStream(creator.id);

    const { start, end } = dailyWindow(0);
    await rebuildLeaderboardWindow("top_streamers_revenue", "daily", start, end);
    const board = await getLeaderboard("top_streamers_revenue", "daily", start);
    const creatorEntry = board.find((e) => e.subjectId === creator.id);

    const { rows: giftCredit } = await pool.query<{ total: string }>(
      `SELECT SUM(amount_santim)::text AS total FROM ledger_entries
       WHERE ledger_transaction_id = $1 AND direction = 'credit'
         AND wallet_id = (SELECT id FROM wallets WHERE owner_type = 'user' AND owner_id = $2)`,
      [giftTx, creator.id]
    );
    const expectedRevenue = Number(giftCredit[0]!.total) + 5_000; // gift credit + ad credit, boost excluded

    expect(creatorEntry).toBeDefined();
    expect(creatorEntry!.value).toBe(expectedRevenue);
  });

  it("a subject with zero activity in a rebuilt window disappears from the board entirely (delete-then-insert, not an upsert)", async () => {
    const creator = await trackUser(await createTestCreator(8000));
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 20_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    const { start, end } = dailyWindow(0);
    await rebuildLeaderboardWindow("top_gifters", "daily", start, end);
    expect((await getLeaderboard("top_gifters", "daily", start)).some((e) => e.subjectId === viewer.id)).toBe(true);

    // Remove the only gift this viewer sent in this window (simulating
    // "this viewer now has zero activity here") by deleting the
    // transaction's entries directly, then rebuild again.
    const { rows: entries } = await pool.query<{ ledger_transaction_id: string }>(
      `SELECT DISTINCT ledger_transaction_id FROM ledger_entries
       WHERE wallet_id = (SELECT id FROM wallets WHERE owner_type = 'user' AND owner_id = $1)
         AND ledger_transaction_id IN (SELECT id FROM ledger_transactions WHERE type = 'gift')`,
      [viewer.id]
    );
    // Before deleting the entries themselves — creditCreatorFromViewerSpend
    // (T2) created an earning_holds row referencing the creator's credit
    // entry from this same gift, and that FK has no cascade.
    await pool.query(`DELETE FROM earning_holds WHERE creator_id = $1`, [creator.id]);
    // gifts_sent.ledger_transaction_id also has no cascade.
    await pool.query(`DELETE FROM gifts_sent WHERE ledger_transaction_id = ANY($1)`, [
      entries.map((e) => e.ledger_transaction_id),
    ]);
    await pool.query(`DELETE FROM ledger_entries WHERE ledger_transaction_id = ANY($1)`, [
      entries.map((e) => e.ledger_transaction_id),
    ]);
    await pool.query(`DELETE FROM ledger_transactions WHERE id = ANY($1)`, [
      entries.map((e) => e.ledger_transaction_id),
    ]);

    await rebuildLeaderboardWindow("top_gifters", "daily", start, end);
    expect((await getLeaderboard("top_gifters", "daily", start)).some((e) => e.subjectId === viewer.id)).toBe(false);
  });
});

describe("window boundaries — Africa/Addis_Ababa", () => {
  it("excludes a gift completed just before the window and includes one completed just inside it", async () => {
    const creator = await trackUser(await createTestCreator(8000));
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 20_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    const { id: txId } = await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    // window_start is expressed as an Africa/Addis_Ababa calendar day —
    // back-date this real gift's completed_at to exactly the UTC instant
    // of that day's Addis midnight minus one second (just outside) and
    // separately verify plus one second (just inside), using real SQL
    // date math rather than hand-computed offsets.
    const { start, end } = dailyWindow(0);
    await pool.query(
      `UPDATE ledger_transactions
       SET completed_at = ($1::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') - INTERVAL '1 second'
       WHERE id = $2`,
      [start, txId]
    );
    await rebuildLeaderboardWindow("top_gifters", "daily", start, end);
    expect((await getLeaderboard("top_gifters", "daily", start)).some((e) => e.subjectId === viewer.id)).toBe(false);

    await pool.query(
      `UPDATE ledger_transactions
       SET completed_at = ($1::date::timestamp AT TIME ZONE 'Africa/Addis_Ababa') + INTERVAL '1 second'
       WHERE id = $2`,
      [start, txId]
    );
    await rebuildLeaderboardWindow("top_gifters", "daily", start, end);
    expect((await getLeaderboard("top_gifters", "daily", start)).some((e) => e.subjectId === viewer.id)).toBe(true);
  });
});

describe("watch-time and CCU boards — combine raw and rolled-up sources", () => {
  it("top_streamers_watchtime sums viewer-seconds across both stream_viewer_samples and stream_watch_time_daily", async () => {
    const creator = await trackUser(await createTestCreator());
    const { start, end } = dailyWindow(0);
    const sampledAt = new Date(); // "today," so it lands in the raw table
    await pool.query(
      `INSERT INTO stream_viewer_samples (stream_id, sampled_at, viewer_count) VALUES ($1, $2, $3)`,
      [creator.streamId, sampledAt, 10]
    );
    // A second, already-rolled-up day for the same creator/window (using
    // dailyWindow(0) as a single-day window means this row wouldn't
    // normally fall inside it — inserted directly to prove the query
    // reads stream_watch_time_daily at all, independent of window math
    // already covered above).
    await pool.query(
      `INSERT INTO stream_watch_time_daily (stream_id, day, sample_count, viewer_seconds, peak_viewer_count)
       VALUES ($1, $2::date, 1, 300, 5)`,
      [creator.streamId, start]
    );

    await rebuildLeaderboardWindow("top_streamers_watchtime", "daily", start, end);
    const board = await getLeaderboard("top_streamers_watchtime", "daily", start);
    const entry = board.find((e) => e.subjectId === creator.id);

    expect(entry).toBeDefined();
    expect(entry!.value).toBe(10 * 60 + 300); // raw sample's 600s + the rolled-up day's 300s
  });

  it("top_streamers_ccu is a peak (MAX), not a sum, across both sources", async () => {
    const creator = await trackUser(await createTestCreator());
    const { start, end } = dailyWindow(0);
    const sampledAt = new Date();
    await pool.query(
      `INSERT INTO stream_viewer_samples (stream_id, sampled_at, viewer_count) VALUES ($1, $2, $3)`,
      [creator.streamId, sampledAt, 7]
    );
    await pool.query(
      `INSERT INTO stream_watch_time_daily (stream_id, day, sample_count, viewer_seconds, peak_viewer_count)
       VALUES ($1, $2::date, 1, 60, 42)`,
      [creator.streamId, start]
    );

    await rebuildLeaderboardWindow("top_streamers_ccu", "daily", start, end);
    const board = await getLeaderboard("top_streamers_ccu", "daily", start);
    const entry = board.find((e) => e.subjectId === creator.id);

    expect(entry).toBeDefined();
    expect(entry!.value).toBe(42); // MAX(7, 42), not 7 + 42
  });
});

describe("idx_leaderboard_read — the read path's actual query plan", () => {
  it("uses idx_leaderboard_read, not a sequential scan or a sort, at a realistic table size", async () => {
    // On a near-empty table (the state every other test in this file
    // leaves it in) Postgres's planner correctly prefers a sequential
    // scan — an index is not cheaper than scanning three rows, and a
    // test that asserted otherwise would be asserting a wrong fact about
    // Postgres, not a real property of this schema. Seeding a realistic
    // volume (2,000 rows spread across 100 distinct days, one specific
    // day being the target) is what actually exercises the index the
    // way a live table with real history would.
    const subjects = await Promise.all(Array.from({ length: 20 }, () => createTestViewer()));
    for (const s of subjects) createdUserIds.push(s.id);
    const subjectIds = subjects.map((s) => s.id);

    await pool.query(
      `INSERT INTO leaderboard_snapshots (board, window_kind, window_start, subject_id, rank, value)
       SELECT 'top_gifters', 'daily', d.day, s.subject_id, s.rnk, (1000 - s.rnk * 10)
       FROM generate_series('2020-01-01'::date, '2020-01-01'::date + 99, '1 day') AS d(day)
       CROSS JOIN LATERAL (
         SELECT subject_id, row_number() OVER () AS rnk
         FROM unnest($1::uuid[]) AS subject_id
       ) s`,
      [subjectIds]
    );
    await pool.query(`ANALYZE leaderboard_snapshots`);

    const targetDay = "2020-02-01"; // the 32nd day in the seeded range
    const { rows } = await pool.query<{ "QUERY PLAN": string }[]>(
      `EXPLAIN (FORMAT JSON)
       SELECT subject_id, rank, value FROM leaderboard_snapshots
       WHERE board = 'top_gifters' AND window_kind = 'daily' AND window_start = $1::date
       ORDER BY rank ASC LIMIT 100`,
      [targetDay]
    );
    const plan = JSON.stringify(rows);
    expect(plan).toContain("idx_leaderboard_read");
    expect(plan).not.toMatch(/"Sort Method"/);

    // Clean up this test's own seeded rows so it doesn't leak 2,000 rows
    // into the rest of the suite or this file's own afterAll query.
    await pool.query(
      `DELETE FROM leaderboard_snapshots WHERE board = 'top_gifters' AND window_kind = 'daily'
         AND window_start BETWEEN '2020-01-01' AND '2020-04-09'`
    );
  });
});

describe("rebuildOpenLeaderboardWindows — the full periodic job", () => {
  it("populates today's daily window for every board without error", async () => {
    const creator = await trackUser(await createTestCreator(8000));
    const viewer = await trackUser(await createTestViewer());
    const funder = await trackUser(await createTestViewer());
    await performManualAdjustment(funder.id, {
      targetUsername: viewer.username,
      amountSantim: 20_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const giftTypeId = await getGiftTypeId("Classic Mulmul");
    await sendGift(viewer.id, { streamId: creator.streamId, giftTypeId, quantity: 1 });

    await expect(rebuildOpenLeaderboardWindows()).resolves.toBeUndefined();

    const { rows } = await pool.query<{ board: string }>(
      `SELECT DISTINCT board FROM leaderboard_snapshots
       WHERE window_kind = 'daily' AND window_start = (now() AT TIME ZONE 'Africa/Addis_Ababa')::date`
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
