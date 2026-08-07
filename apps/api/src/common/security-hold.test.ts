import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./db.js";
import { getActiveSecurityHold, recordSecurityEvent } from "./security-hold.js";
import { cleanupTestUsers, createTestViewer, type TestUser } from "../test/fixtures.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("security-hold", () => {
  it("no hold before any security event", async () => {
    const user = await trackUser(await createTestViewer());
    expect(await getActiveSecurityHold(user.id)).toBeNull();
  });

  it("an active hold appears immediately after a password change, with a ~72h window", async () => {
    const user = await trackUser(await createTestViewer());
    await recordSecurityEvent(user.id, "password_change");

    const hold = await getActiveSecurityHold(user.id);
    expect(hold).not.toBeNull();
    expect(hold!.eventType).toBe("password_change");
    const hours = (hold!.until.getTime() - hold!.since.getTime()) / (60 * 60 * 1000);
    expect(hours).toBeCloseTo(72, 1);
  });

  it("totp_enabled and totp_disabled both trigger a hold", async () => {
    const enabledUser = await trackUser(await createTestViewer());
    await recordSecurityEvent(enabledUser.id, "totp_enabled");
    expect((await getActiveSecurityHold(enabledUser.id))!.eventType).toBe("totp_enabled");

    const disabledUser = await trackUser(await createTestViewer());
    await recordSecurityEvent(disabledUser.id, "totp_disabled");
    expect((await getActiveSecurityHold(disabledUser.id))!.eventType).toBe("totp_disabled");
  });

  it("a newer event's hold reflects the newer event, not an older one", async () => {
    const user = await trackUser(await createTestViewer());
    await recordSecurityEvent(user.id, "password_change");
    await recordSecurityEvent(user.id, "totp_enabled");

    const hold = await getActiveSecurityHold(user.id);
    expect(hold!.eventType).toBe("totp_enabled");
  });

  it("an event older than 72h no longer produces an active hold", async () => {
    const user = await trackUser(await createTestViewer());
    // Directly backdates created_at past the 72h window — the real code
    // path (recordSecurityEvent) always inserts "now", so this simulates
    // time passing rather than exercising a fake clock.
    await pool.query(
      `INSERT INTO security_events (user_id, event_type, created_at)
       VALUES ($1, 'password_change', now() - interval '73 hours')`,
      [user.id]
    );

    expect(await getActiveSecurityHold(user.id)).toBeNull();
  });

  it("an event just under 72h old still produces an active hold", async () => {
    const user = await trackUser(await createTestViewer());
    await pool.query(
      `INSERT INTO security_events (user_id, event_type, created_at)
       VALUES ($1, 'password_change', now() - interval '71 hours')`,
      [user.id]
    );

    expect(await getActiveSecurityHold(user.id)).not.toBeNull();
  });
});
