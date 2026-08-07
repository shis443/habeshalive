import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestCreator, type TestCreator } from "../test/fixtures.js";
import { createSquad, getMySquad, getSquadForUsername, joinSquad, leaveSquad } from "./squad-service.js";

const createdUserIds: string[] = [];

async function trackedCreator(): Promise<TestCreator> {
  // createTestCreator already inserts a 'live' stream — see test/fixtures.ts —
  // so every creator this returns satisfies squad-service.ts's requireLive
  // check without further setup.
  const creator = await createTestCreator();
  createdUserIds.push(creator.id);
  return creator;
}

async function endStream(streamId: string): Promise<void> {
  await pool.query(`UPDATE streams SET status = 'ended', ended_at = now() WHERE id = $1`, [streamId]);
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("createSquad", () => {
  it("creates a squad with the creator as its first member, stream attached", async () => {
    const creator = await trackedCreator();
    const squad = await createSquad(creator.id, "Test Squad");

    expect(squad.name).toBe("Test Squad");
    expect(squad.inviteCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(squad.members).toHaveLength(1);
    expect(squad.members[0]!.creatorId).toBe(creator.id);
    expect(squad.members[0]!.stream?.id).toBe(creator.streamId);
  });

  it("rejects creating a squad while not live", async () => {
    const creator = await trackedCreator();
    await endStream(creator.streamId);
    await expect(createSquad(creator.id)).rejects.toThrow(/must be live/);
  });

  it("rejects creating a second squad while already in one", async () => {
    const creator = await trackedCreator();
    await createSquad(creator.id);
    await expect(createSquad(creator.id)).rejects.toThrow(/already in a squad/);
  });
});

describe("joinSquad", () => {
  it("adds a second live creator to an existing squad", async () => {
    const host = await trackedCreator();
    const guest = await trackedCreator();
    const created = await createSquad(host.id);

    const joined = await joinSquad(guest.id, created.inviteCode);
    expect(joined.id).toBe(created.id);
    expect(joined.members).toHaveLength(2);
    expect(joined.members.map((m) => m.creatorId).sort()).toEqual([guest.id, host.id].sort());
  });

  it("is case-insensitive on the invite code", async () => {
    const host = await trackedCreator();
    const guest = await trackedCreator();
    const created = await createSquad(host.id);

    const joined = await joinSquad(guest.id, created.inviteCode.toLowerCase());
    expect(joined.members).toHaveLength(2);
  });

  it("rejects an invalid invite code", async () => {
    const guest = await trackedCreator();
    await expect(joinSquad(guest.id, "NOTREAL")).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });

  it("rejects joining a second squad while already in one", async () => {
    const hostA = await trackedCreator();
    const hostB = await trackedCreator();
    const guest = await trackedCreator();
    const squadA = await createSquad(hostA.id);
    const squadB = await createSquad(hostB.id);

    await joinSquad(guest.id, squadA.inviteCode);
    await expect(joinSquad(guest.id, squadB.inviteCode)).rejects.toThrow(/already in a squad/);
  });

  it("rejects joining a full squad (max 4)", async () => {
    const host = await trackedCreator();
    const created = await createSquad(host.id);
    for (let i = 0; i < 3; i++) {
      const member = await trackedCreator();
      await joinSquad(member.id, created.inviteCode);
    }
    const fifth = await trackedCreator();
    await expect(joinSquad(fifth.id, created.inviteCode)).rejects.toThrow(/full/);
  });
});

describe("leaveSquad", () => {
  it("removes the creator from the member list", async () => {
    const host = await trackedCreator();
    const guest = await trackedCreator();
    const created = await createSquad(host.id);
    await joinSquad(guest.id, created.inviteCode);

    await leaveSquad(guest.id);

    const mine = await getMySquad(host.id);
    expect(mine!.members).toHaveLength(1);
    expect(mine!.members[0]!.creatorId).toBe(host.id);
  });

  it("ends the squad once the last member leaves, and getMySquad returns null after", async () => {
    const host = await trackedCreator();
    await createSquad(host.id);

    await leaveSquad(host.id);
    expect(await getMySquad(host.id)).toBeNull();

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM squads WHERE created_by = $1`,
      [host.id]
    );
    expect(rows[0]!.status).toBe("ended");
  });

  it("rejects leaving when not in a squad", async () => {
    const creator = await trackedCreator();
    await expect(leaveSquad(creator.id)).rejects.toThrow(/not currently in a squad/);
  });

  it("a creator can join a new squad again after leaving", async () => {
    const host = await trackedCreator();
    const guest = await trackedCreator();
    const first = await createSquad(host.id);
    await joinSquad(guest.id, first.inviteCode);
    await leaveSquad(guest.id);

    const second = await createSquad(guest.id);
    expect(second.id).not.toBe(first.id);
  });
});

describe("getSquadForUsername", () => {
  it("resolves a squad by a member's username, including offline squadmates", async () => {
    const host = await trackedCreator();
    const guest = await trackedCreator();
    await createSquad(host.id, "Public Squad");
    const created = await getMySquad(host.id);
    await joinSquad(guest.id, created!.inviteCode);
    await endStream(guest.streamId);

    const squad = await getSquadForUsername(host.username);
    expect(squad!.name).toBe("Public Squad");
    expect(squad!.members).toHaveLength(2);
    const guestMember = squad!.members.find((m) => m.creatorId === guest.id);
    expect(guestMember!.stream).toBeNull(); // ended their stream, still shown as a member
  });

  it("returns null for an unknown username", async () => {
    expect(await getSquadForUsername("definitely_not_a_real_user")).toBeNull();
  });

  it("returns null for a creator with no active squad", async () => {
    const creator = await trackedCreator();
    expect(await getSquadForUsername(creator.username)).toBeNull();
  });
});
