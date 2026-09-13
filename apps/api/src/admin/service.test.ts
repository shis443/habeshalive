import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { setAdminRequestContext } from "../common/request-context.js";
import { createSession } from "../auth/session-service.js";
import {
  cleanupTestUsers,
  createTestCreator,
  createTestViewer,
  getGiftTypeId,
  type TestUser,
} from "../test/fixtures.js";
import { performManualAdjustment } from "./ledger-service.js";
import { sendGift } from "../wallet/service.js";
import { rebuildLeaderboardWindow } from "./leaderboard-service.js";
import { logAdminAction } from "./audit.js";
import { getAdminSummary, listAdminActions } from "./service.js";

const createdUserIds: string[] = [];

afterAll(async () => {
  // Before cleanupTestUsers — leaderboard_snapshots.subject_id has an FK
  // to users(id) with no cascade, so deleting the users first fails on
  // any row this file's rebuildLeaderboardWindow calls left behind.
  await pool.query(`DELETE FROM leaderboard_snapshots WHERE subject_id = ANY($1)`, [createdUserIds]);
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

async function createAdmin(): Promise<TestUser> {
  const admin = await createTestViewer();
  createdUserIds.push(admin.id);
  await pool.query(`UPDATE users SET role = 'super_admin' WHERE id = $1`, [admin.id]);
  return admin;
}

describe("listAdminActions", () => {
  it("returns actor_ip, actor_session, before_state, after_state for a real logged action", async () => {
    const admin = await createAdmin();
    const sessionId = await createSession(admin.id, "198.51.100.7", "vitest");
    setAdminRequestContext({ actorIp: "198.51.100.7", actorSession: sessionId });
    await logAdminAction(admin.id, "creator.suspend", "creator", admin.id, {
      reason: "test: listAdminActions coverage",
      before: { isSuspended: false },
      after: { isSuspended: true },
    });
    setAdminRequestContext({ actorIp: null, actorSession: null });

    const items = await listAdminActions({ action: "creator.suspend", limit: 500 });
    const found = items.find((i) => i.targetId === admin.id && i.reason === "test: listAdminActions coverage");
    expect(found).toBeDefined();
    expect(found!.actorIp).toBe("198.51.100.7");
    expect(found!.actorSessionId).toBe(sessionId);
    expect(found!.beforeState).toMatchObject({ isSuspended: false });
    expect(found!.afterState).toMatchObject({ isSuspended: true });
  });

  it("filters correctly by session id, and the null-session case doesn't exclude everything", async () => {
    const admin = await createAdmin();
    const sessionA = await createSession(admin.id, "198.51.100.8", "vitest-a");
    const sessionB = await createSession(admin.id, "198.51.100.9", "vitest-b");

    setAdminRequestContext({ actorIp: "198.51.100.8", actorSession: sessionA });
    await logAdminAction(admin.id, "creator.unsuspend", "creator", admin.id, {});
    setAdminRequestContext({ actorIp: "198.51.100.9", actorSession: sessionB });
    await logAdminAction(admin.id, "creator.unsuspend", "creator", admin.id, {});
    setAdminRequestContext({ actorIp: null, actorSession: null });

    const onlyA = await listAdminActions({ action: "creator.unsuspend", session: sessionA, limit: 500 });
    expect(onlyA.every((i) => i.actorSessionId === sessionA)).toBe(true);
    expect(onlyA.some((i) => i.actorSessionId === sessionB)).toBe(false);

    const unfiltered = await listAdminActions({ action: "creator.unsuspend", limit: 500 });
    expect(unfiltered.some((i) => i.actorSessionId === sessionA)).toBe(true);
    expect(unfiltered.some((i) => i.actorSessionId === sessionB)).toBe(true);
  });
});

describe("getAdminSummary — gift volume sourced from the T5 rollup, not a live scan", () => {
  it("reflects a gift only after the leaderboard rebuild job has run for that window, not immediately", async () => {
    const creator = await createTestCreator(8000);
    createdUserIds.push(creator.id);
    const streamId = creator.streamId;

    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);
    const admin = await createTestViewer();
    createdUserIds.push(admin.id);
    await performManualAdjustment(admin.id, {
      targetUsername: viewer.username,
      amountSantim: 50_000,
      direction: "credit_user",
      reason: "test funding",
      fundingBucket: "paid",
    });
    const giftTypeId = await getGiftTypeId("Classic Mulmul");

    const before = await getAdminSummary();
    await sendGift(viewer.id, { streamId, giftTypeId, quantity: 1 });
    const immediatelyAfter = await getAdminSummary();
    // The rollup hasn't been rebuilt yet — this gift is invisible to the
    // summary until the (5-minute, in production) rebuild job runs. This
    // is the real, intended trade-off of moving off a live scan: the
    // Overview tile is now eventually-consistent, not instantaneous.
    expect(immediatelyAfter.giftVolumeSantim).toBe(before.giftVolumeSantim);
    expect(immediatelyAfter.todayGiftVolumeSantim).toBe(before.todayGiftVolumeSantim);

    const { rows: bounds } = await pool.query<{ today: string; tomorrow: string }>(
      `SELECT (now() AT TIME ZONE 'Africa/Addis_Ababa')::date::text AS today,
              ((now() AT TIME ZONE 'Africa/Addis_Ababa')::date + 1)::text AS tomorrow`
    );
    await rebuildLeaderboardWindow("top_gifters", "daily", bounds[0]!.today, bounds[0]!.tomorrow);
    await rebuildLeaderboardWindow("top_gifters", "alltime", "1970-01-01", "9999-12-31");

    const afterRebuild = await getAdminSummary();
    expect(afterRebuild.giftVolumeSantim).toBeGreaterThan(before.giftVolumeSantim);
    expect(afterRebuild.todayGiftVolumeSantim).toBeGreaterThan(before.todayGiftVolumeSantim);
  });
});
