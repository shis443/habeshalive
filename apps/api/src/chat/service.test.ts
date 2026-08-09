import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestCreator, type TestUser } from "../test/fixtures.js";
import { grantChannelModerator } from "../moderation/channel-mods-service.js";
import { deleteChatMessage, getChatHistory, purgeOldChatMessages, sendChatMessage } from "./service.js";

const createdUserIds: string[] = [];

async function trackedCreator(): Promise<TestCreator> {
  const creator = await createTestCreator();
  createdUserIds.push(creator.id);
  return creator;
}

async function trackedViewer(): Promise<TestUser> {
  const viewer = await createTestViewer();
  createdUserIds.push(viewer.id);
  return viewer;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

// Centrifugo isn't running in this test env — publishToCentrifugo's own
// try/catch already fails open on a connection refusal (same reasoning as
// notifications/service.ts's publishUnreadUpdate), so no fetch stub is
// needed for these tests to pass; stubbed anyway to keep stderr clean.
function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
  );
}

describe("sendChatMessage", () => {
  it("rejects a viewer blocked from this creator's channel", async () => {
    const creator = await trackedCreator();
    const viewer = await trackedViewer();
    stubFetch();
    await pool.query(`INSERT INTO channel_blocks (creator_id, blocked_user_id, blocked_by) VALUES ($1, $2, $3)`, [
      creator.id,
      viewer.id,
      creator.id,
    ]);

    await expect(sendChatMessage(viewer.id, creator.streamId, "hey")).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  it("still lets an unblocked viewer send", async () => {
    const creator = await trackedCreator();
    const viewer = await trackedViewer();
    stubFetch();

    const message = await sendChatMessage(viewer.id, creator.streamId, "hello there");
    expect(message.body).toBe("hello there");
    expect(message.userId).toBe(viewer.id);
  });
});

describe("deleteChatMessage", () => {
  it("lets the stream owner soft-delete a message, which then disappears from history", async () => {
    const creator = await trackedCreator();
    const viewer = await trackedViewer();
    stubFetch();
    const message = await sendChatMessage(viewer.id, creator.streamId, "delete me");

    await deleteChatMessage(creator.id, creator.streamId, message.id);

    const history = await getChatHistory(creator.streamId);
    expect(history.find((m) => m.id === message.id)).toBeUndefined();
    const { rows } = await pool.query<{ is_deleted: boolean }>(`SELECT is_deleted FROM chat_messages WHERE id = $1`, [
      message.id,
    ]);
    expect(rows[0]!.is_deleted).toBe(true);
  });

  it("lets a granted channel moderator delete a message", async () => {
    const creator = await trackedCreator();
    const mod = await trackedViewer();
    const viewer = await trackedViewer();
    stubFetch();
    await grantChannelModerator(creator.id, creator.id, mod.username);
    const message = await sendChatMessage(viewer.id, creator.streamId, "mod should be able to delete this");

    await expect(deleteChatMessage(mod.id, creator.streamId, message.id)).resolves.toBeUndefined();
  });

  it("rejects a viewer with no moderation standing on this channel", async () => {
    const creator = await trackedCreator();
    const viewer = await trackedViewer();
    const stranger = await trackedViewer();
    stubFetch();
    const message = await sendChatMessage(viewer.id, creator.streamId, "not yours to delete");

    await expect(deleteChatMessage(stranger.id, creator.streamId, message.id)).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
  });

  it("404s deleting an already-deleted or nonexistent message", async () => {
    const creator = await trackedCreator();
    stubFetch();
    await expect(
      deleteChatMessage(creator.id, creator.streamId, "00000000-0000-0000-0000-000000000000")
    ).rejects.toMatchObject({ statusCode: 404 } satisfies Partial<AppError>);
  });
});

describe("purgeOldChatMessages", () => {
  it("deletes messages older than 30 days, leaves recent ones", async () => {
    const creator = await trackedCreator();
    const viewer = await trackedViewer();
    stubFetch();
    const oldMessage = await sendChatMessage(viewer.id, creator.streamId, "ancient history");
    const recentMessage = await sendChatMessage(viewer.id, creator.streamId, "still relevant");

    await pool.query(`UPDATE chat_messages SET created_at = now() - interval '31 days' WHERE id = $1`, [
      oldMessage.id,
    ]);

    const deletedCount = await purgeOldChatMessages();
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM chat_messages WHERE id = ANY($1)`, [
      [oldMessage.id, recentMessage.id],
    ]);
    expect(rows.map((r) => r.id)).toEqual([recentMessage.id]);
  });

  it("unpins a message when it ages out — pinned_messages cascades on delete", async () => {
    const creator = await trackedCreator();
    const viewer = await trackedViewer();
    stubFetch();
    const message = await sendChatMessage(viewer.id, creator.streamId, "pin me then age me out");
    await pool.query(
      `INSERT INTO pinned_messages (stream_id, message_id, pinned_by) VALUES ($1, $2, $3)`,
      [creator.streamId, message.id, creator.id]
    );
    await pool.query(`UPDATE chat_messages SET created_at = now() - interval '31 days' WHERE id = $1`, [
      message.id,
    ]);

    await purgeOldChatMessages();

    const { rows } = await pool.query(`SELECT 1 FROM pinned_messages WHERE stream_id = $1`, [creator.streamId]);
    expect(rows).toHaveLength(0);
  });
});
