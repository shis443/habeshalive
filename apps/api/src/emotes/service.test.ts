import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { subscribeToPlatform } from "../subscriptions/platform-service.js";
import { cleanupTestUsers, createTestViewer, type TestUser } from "../test/fixtures.js";

// Same posture as kyc/service.test.ts — real object storage isn't
// configured in this test env (VOD_S3_* unset).
const uploadObjectMock = vi.fn(async (key: string, _body: Buffer, _contentType: string) => key);
const deleteObjectMock = vi.fn(async (_key: string) => {});
vi.mock("../common/object-storage.js", () => ({
  isObjectStorageConfigured: true,
  uploadObject: (...args: [string, Buffer, string]) => uploadObjectMock(...args),
  deleteObject: (...args: [string]) => deleteObjectMock(...args),
  getObjectBuffer: async (key: string) => ({ buffer: Buffer.from(`img:${key}`), contentType: "image/png" }),
}));

const {
  approveEmote,
  createEmote,
  deleteEmoteOwned,
  getApprovedEmoteCatalog,
  getEmoteImage,
  listEmotesForAdmin,
  listMyEmotes,
  rejectEmote,
} = await import("./service.js");

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

async function makeAdmin(): Promise<TestUser> {
  const admin = await trackUser(await createTestViewer());
  await pool.query(`UPDATE users SET role = 'super_admin' WHERE id = $1`, [admin.id]);
  return admin;
}

// subscribeToPlatform charges the real ledger — same direct cache-balance
// seed as vods/create-vod-from-recording.test.ts's fundWallet, not a real
// counterparty transaction (there isn't one to model here).
async function makeBirqPlusSubscriber(): Promise<TestUser> {
  const user = await trackUser(await createTestViewer());
  await pool.query(`UPDATE wallet_balances_cache SET balance_santim = 15000 WHERE wallet_id = $1`, [user.walletId]);
  await subscribeToPlatform(user.id, 15000);
  return user;
}

const validPng = { buffer: Buffer.from([1, 2, 3, 4]), contentType: "image/png" };

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(() => {
  uploadObjectMock.mockClear();
  deleteObjectMock.mockClear();
});

describe("createEmote", () => {
  it("rejects a non-Birq-Plus user", async () => {
    const viewer = await trackUser(await createTestViewer());
    await expect(createEmote(viewer.id, "pogChamp", validPng.buffer, validPng.contentType)).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<AppError>);
    expect(uploadObjectMock).not.toHaveBeenCalled();
  });

  it("uploads and creates a pending emote for a Birq Plus subscriber", async () => {
    const subscriber = await makeBirqPlusSubscriber();

    const emote = await createEmote(subscriber.id, "pogChamp", validPng.buffer, validPng.contentType);

    expect(emote.code).toBe("pogChamp");
    expect(emote.status).toBe("pending");
    expect(emote.rejectionReason).toBeNull();
    expect(uploadObjectMock).toHaveBeenCalledTimes(1);
    const [key, , contentType] = uploadObjectMock.mock.calls[0]!;
    expect(key).toMatch(new RegExp(`^emotes/${subscriber.id}/.+`));
    expect(contentType).toBe("image/png");
  });

  it("rejects an invalid code", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    await expect(createEmote(subscriber.id, "a b!", validPng.buffer, validPng.contentType)).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("rejects a disallowed content type", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    await expect(createEmote(subscriber.id, "validCode", validPng.buffer, "image/svg+xml")).rejects.toMatchObject({
      statusCode: 400,
    } satisfies Partial<AppError>);
  });

  it("rejects a duplicate code", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    await createEmote(subscriber.id, "dupeCode", validPng.buffer, validPng.contentType);
    await expect(createEmote(subscriber.id, "dupeCode", validPng.buffer, validPng.contentType)).rejects.toMatchObject(
      { statusCode: 409 } satisfies Partial<AppError>
    );
  });

  it("enforces the per-creator slot cap", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    await pool.query(`UPDATE platform_config SET birq_plus_emote_slot_count = 1 WHERE id = TRUE`);
    try {
      await createEmote(subscriber.id, "firstOne", validPng.buffer, validPng.contentType);
      await expect(createEmote(subscriber.id, "secondOne", validPng.buffer, validPng.contentType)).rejects.toMatchObject(
        { statusCode: 400 } satisfies Partial<AppError>
      );
    } finally {
      await pool.query(`UPDATE platform_config SET birq_plus_emote_slot_count = 5 WHERE id = TRUE`);
    }
  });
});

describe("catalog and image serving", () => {
  it("only lists approved emotes in the public catalog", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    const admin = await makeAdmin();
    const pending = await createEmote(subscriber.id, "stillPending", validPng.buffer, validPng.contentType);
    const approved = await createEmote(subscriber.id, "nowApproved", validPng.buffer, validPng.contentType);
    await approveEmote(admin.id, approved.id);

    const catalog = await getApprovedEmoteCatalog();

    expect(catalog.some((e) => e.id === approved.id)).toBe(true);
    expect(catalog.some((e) => e.id === pending.id)).toBe(false);
  });

  it("serves an emote's stored image bytes", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    const emote = await createEmote(subscriber.id, "hasImage", validPng.buffer, validPng.contentType);

    const { buffer, contentType } = await getEmoteImage(emote.id);

    expect(contentType).toBe("image/png");
    expect(buffer.toString()).toContain(`emotes/${subscriber.id}/`);
  });

  it("404s for a nonexistent emote image", async () => {
    await expect(getEmoteImage("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);
  });
});

describe("listMyEmotes / deleteEmoteOwned", () => {
  it("lists every status for the owning creator, newest first", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    const first = await createEmote(subscriber.id, "firstMine", validPng.buffer, validPng.contentType);
    const second = await createEmote(subscriber.id, "secondMine", validPng.buffer, validPng.contentType);

    const mine = await listMyEmotes(subscriber.id);

    expect(mine.map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it("deletes cleanly and rejects deleting someone else's emote", async () => {
    const owner = await makeBirqPlusSubscriber();
    const stranger = await trackUser(await createTestViewer());
    const emote = await createEmote(owner.id, "deleteMe", validPng.buffer, validPng.contentType);

    await expect(deleteEmoteOwned(emote.id, stranger.id)).rejects.toMatchObject({
      statusCode: 404,
    } satisfies Partial<AppError>);

    await deleteEmoteOwned(emote.id, owner.id);
    expect(deleteObjectMock).toHaveBeenCalledWith(expect.stringContaining(`emotes/${owner.id}/`));
    expect(await listMyEmotes(owner.id)).toEqual([]);
  });
});

describe("admin review queue", () => {
  it("approves a pending emote and moves it out of the pending queue", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    const admin = await makeAdmin();
    const emote = await createEmote(subscriber.id, "approveMe", validPng.buffer, validPng.contentType);

    await approveEmote(admin.id, emote.id);

    const [mine] = await listMyEmotes(subscriber.id);
    expect(mine!.status).toBe("approved");
    const pending = await listEmotesForAdmin("pending");
    expect(pending.some((e) => e.id === emote.id)).toBe(false);
  });

  it("rejects a pending emote with a reason", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    const admin = await makeAdmin();
    const emote = await createEmote(subscriber.id, "rejectMe", validPng.buffer, validPng.contentType);

    await rejectEmote(admin.id, emote.id, "Not a real emote");

    const [mine] = await listMyEmotes(subscriber.id);
    expect(mine!.status).toBe("rejected");
    expect(mine!.rejectionReason).toBe("Not a real emote");
  });

  it("404s approving/rejecting an already-reviewed or nonexistent emote", async () => {
    const subscriber = await makeBirqPlusSubscriber();
    const admin = await makeAdmin();
    const emote = await createEmote(subscriber.id, "onlyOnce", validPng.buffer, validPng.contentType);

    await approveEmote(admin.id, emote.id);

    await expect(approveEmote(admin.id, emote.id)).rejects.toThrow(AppError);
    await expect(rejectEmote(admin.id, emote.id, "too late")).rejects.toThrow(AppError);
    await expect(approveEmote(admin.id, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });
});
