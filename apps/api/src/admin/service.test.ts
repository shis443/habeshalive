import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { setAdminRequestContext } from "../common/request-context.js";
import { createSession } from "../auth/session-service.js";
import { cleanupTestUsers, createTestViewer, type TestUser } from "../test/fixtures.js";
import { logAdminAction } from "./audit.js";
import { listAdminActions } from "./service.js";

const createdUserIds: string[] = [];

afterAll(async () => {
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
