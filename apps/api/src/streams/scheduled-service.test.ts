import { afterAll, describe, expect, it } from "vitest";
import { AppError } from "../common/errors.js";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestCreator } from "../test/fixtures.js";
import {
  autoCancelStaleScheduledStreams,
  cancelScheduledStream,
  createOrReplaceScheduledStream,
  getMyScheduledStream,
  getScheduledStreamForUsername,
  promoteScheduledStreamsForCreator,
} from "./scheduled-service.js";

const createdUserIds: string[] = [];

afterAll(async () => {
  // scheduled_streams.creator_id cascades from users — no manual cleanup
  // needed beyond cleanupTestUsers itself.
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString();
}

describe("createOrReplaceScheduledStream", () => {
  it("rejects a scheduledAt that isn't in the future", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    await expect(
      createOrReplaceScheduledStream(creator.id, {
        title: "Too late",
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      })
    ).rejects.toThrow(/future/);
  });

  it("creates a real row, readable via getMyScheduledStream and getScheduledStreamForUsername", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    const created = await createOrReplaceScheduledStream(creator.id, {
      title: "Friday night stream",
      caption: "Come hang out",
      category: "Music",
      scheduledAt: futureIso(24),
    });

    expect(created.status).toBe("scheduled");
    expect(created.streamId).toBeNull();

    const mine = await getMyScheduledStream(creator.id);
    expect(mine?.id).toBe(created.id);
    expect(mine?.title).toBe("Friday night stream");

    const public_ = await getScheduledStreamForUsername(creator.username);
    expect(public_?.id).toBe(created.id);
  });

  it("replaces an existing pending schedule rather than stacking a second one", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    const first = await createOrReplaceScheduledStream(creator.id, {
      title: "First plan",
      scheduledAt: futureIso(24),
    });
    const second = await createOrReplaceScheduledStream(creator.id, {
      title: "Actually, this instead",
      scheduledAt: futureIso(48),
    });

    expect(second.id).not.toBe(first.id);
    const mine = await getMyScheduledStream(creator.id);
    expect(mine?.id).toBe(second.id);
    expect(mine?.title).toBe("Actually, this instead");
  });
});

describe("cancelScheduledStream", () => {
  it("cancels a pending schedule so it no longer appears as scheduled", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    await createOrReplaceScheduledStream(creator.id, { title: "Plan", scheduledAt: futureIso(24) });

    await cancelScheduledStream(creator.id);

    expect(await getMyScheduledStream(creator.id)).toBeNull();
  });

  it("404s when there's nothing pending to cancel", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    await expect(cancelScheduledStream(creator.id)).rejects.toThrow(AppError);
  });
});

describe("promoteScheduledStreamsForCreator", () => {
  it("flips a pending schedule to live and backfills stream_id", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);
    const created = await createOrReplaceScheduledStream(creator.id, {
      title: "Plan",
      scheduledAt: futureIso(1),
    });

    await promoteScheduledStreamsForCreator(creator.id, creator.streamId);

    expect(await getMyScheduledStream(creator.id)).toBeNull(); // no longer 'scheduled'
    const { rows } = await pool.query(`SELECT status, stream_id FROM scheduled_streams WHERE id = $1`, [
      created.id,
    ]);
    expect(rows[0].status).toBe("live");
    expect(rows[0].stream_id).toBe(creator.streamId);
  });

  it("is a no-op when the creator has no pending schedule", async () => {
    const creator = await createTestCreator();
    createdUserIds.push(creator.id);

    await expect(promoteScheduledStreamsForCreator(creator.id, creator.streamId)).resolves.toBeUndefined();
  });
});

describe("autoCancelStaleScheduledStreams", () => {
  it("cancels a schedule long past its time with no matching stream, leaves a fresh one alone", async () => {
    const staleCreator = await createTestCreator();
    createdUserIds.push(staleCreator.id);
    const freshCreator = await createTestCreator();
    createdUserIds.push(freshCreator.id);

    await createOrReplaceScheduledStream(staleCreator.id, { title: "Old plan", scheduledAt: futureIso(1) });
    // Backdate past the grace window directly — createOrReplace itself
    // rejects a non-future scheduledAt, so this simulates time passing.
    await pool.query(
      `UPDATE scheduled_streams SET scheduled_at = now() - interval '7 hours' WHERE creator_id = $1`,
      [staleCreator.id]
    );
    await createOrReplaceScheduledStream(freshCreator.id, { title: "New plan", scheduledAt: futureIso(24) });

    await autoCancelStaleScheduledStreams();

    expect(await getMyScheduledStream(staleCreator.id)).toBeNull();
    expect(await getMyScheduledStream(freshCreator.id)).not.toBeNull();
  });
});
