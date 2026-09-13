import { afterAll, afterEach, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { setAdminRequestContext } from "../common/request-context.js";
import { createSession } from "../auth/session-service.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestUser } from "../test/fixtures.js";
import { logAdminAction } from "../admin/audit.js";
import { sendChatMessage } from "../chat/service.js";
import { adminRevokeIngestKey, muteStreamChat, unmuteStreamChat } from "./emergency-controls-service.js";

const createdUserIds: string[] = [];
const createdStreamIds: string[] = [];

afterAll(async () => {
  if (createdStreamIds.length > 0) {
    await pool.query(`DELETE FROM streams WHERE id = ANY($1::uuid[])`, [createdStreamIds]);
  }
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(() => {
  setAdminRequestContext({ actorIp: null, actorSession: null });
});

async function createAdmin(): Promise<TestUser> {
  const admin = await createTestViewer();
  createdUserIds.push(admin.id);
  await pool.query(`UPDATE users SET role = 'super_admin' WHERE id = $1`, [admin.id]);
  return admin;
}

async function createLiveStream(): Promise<{ streamId: string; creatorId: string }> {
  const creator = await createTestCreator();
  createdUserIds.push(creator.id);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO streams (creator_id, title, status, started_at) VALUES ($1, 'emergency-controls test', 'live', now()) RETURNING id`,
    [creator.id]
  );
  createdStreamIds.push(rows[0]!.id);
  return { streamId: rows[0]!.id, creatorId: creator.id };
}

describe("muteStreamChat / unmuteStreamChat", () => {
  it("blocks sendChatMessage while muted and allows it again once unmuted", async () => {
    const admin = await createAdmin();
    const { streamId, creatorId } = await createLiveStream();
    const viewer = await createTestViewer();
    createdUserIds.push(viewer.id);

    // Unmuted by default — no stream_controls row exists yet.
    const msg1 = await sendChatMessage(viewer.id, streamId, "hello before mute");
    expect(msg1.body).toBe("hello before mute");

    await muteStreamChat(admin.id, streamId, "test: raid brigading");
    await expect(sendChatMessage(viewer.id, streamId, "should be blocked")).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);

    await unmuteStreamChat(admin.id, streamId, "test: raid over");
    const msg2 = await sendChatMessage(viewer.id, streamId, "hello after unmute");
    expect(msg2.body).toBe("hello after unmute");

    void creatorId;
  });

  it("rejects unmuting a stream that isn't muted", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    await expect(unmuteStreamChat(admin.id, streamId, "test: nothing to undo")).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("records real before/after state and a non-empty reason on admin_actions", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    await muteStreamChat(admin.id, streamId, "test: audit trail check");

    const { rows } = await pool.query<{ before_state: unknown; after_state: unknown; reason: string | null }>(
      `SELECT before_state, after_state, reason FROM admin_actions
       WHERE action = 'stream.mute_chat' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [streamId]
    );
    expect(rows[0]?.reason).toBe("test: audit trail check");
    expect(rows[0]?.before_state).toMatchObject({ chatMuted: false });
    expect(rows[0]?.after_state).toMatchObject({ chatMuted: true });
  });
});

describe("adminRevokeIngestKey", () => {
  it("actually rotates the creator's stream key", async () => {
    const admin = await createAdmin();
    const { streamId, creatorId } = await createLiveStream();
    const before = await pool.query<{ stream_key: string }>(
      `SELECT stream_key FROM creator_profiles WHERE user_id = $1`,
      [creatorId]
    );

    await adminRevokeIngestKey(admin.id, streamId, "test: leaked key");

    const after = await pool.query<{ stream_key: string }>(
      `SELECT stream_key FROM creator_profiles WHERE user_id = $1`,
      [creatorId]
    );
    expect(after.rows[0]!.stream_key).not.toBe(before.rows[0]!.stream_key);

    const { rows } = await pool.query<{ reason: string | null }>(
      `SELECT reason FROM admin_actions WHERE action = 'stream.revoke_ingest' AND target_id = $1`,
      [streamId]
    );
    expect(rows[0]?.reason).toBe("test: leaked key");
  });
});

describe("admin_actions.actor_session foreign key, against a real session row", () => {
  it("accepts a jti minted by the real createSession path", async () => {
    const admin = await createAdmin();
    const { streamId } = await createLiveStream();
    // The real path a login-issued JWT's jti comes from — not a
    // hand-picked UUID, since the whole risk being checked is whether a
    // genuine session id round-trips through the FK cleanly.
    const sessionId = await createSession(admin.id, "203.0.113.5", "vitest");

    setAdminRequestContext({ actorIp: "203.0.113.5", actorSession: sessionId });
    await muteStreamChat(admin.id, streamId, "test: real session fk");

    const { rows } = await pool.query<{ actor_ip: string; actor_session: string }>(
      `SELECT actor_ip, actor_session FROM admin_actions
       WHERE action = 'stream.mute_chat' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [streamId]
    );
    expect(rows[0]?.actor_ip).toBe("203.0.113.5");
    expect(rows[0]?.actor_session).toBe(sessionId);
  });
});

describe("logAdminAction ambient context", () => {
  it("defaults to null actor_ip/actor_session outside any request context", async () => {
    const admin = await createAdmin();
    setAdminRequestContext({ actorIp: null, actorSession: null });
    await logAdminAction(admin.id, "ad_campaign.create", "ad_campaign", admin.id, { metadata: {} });
    const { rows } = await pool.query<{ actor_ip: string | null; actor_session: string | null }>(
      `SELECT actor_ip, actor_session FROM admin_actions
       WHERE action = 'ad_campaign.create' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [admin.id]
    );
    expect(rows[0]?.actor_ip).toBeNull();
    expect(rows[0]?.actor_session).toBeNull();
  });
});
