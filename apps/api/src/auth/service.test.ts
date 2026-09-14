import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestViewer } from "../test/fixtures.js";
import { getMyAccount, updateProfile } from "./service.js";

// No test file exercised getMyAccount/updateProfile before this pass —
// a real gap, since this is the only path that writes to `users.bio`/
// `users.social_links`.

const createdUserIds: string[] = [];

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("getMyAccount / updateProfile", () => {
  it("defaults socialLinks to an empty object for a freshly created user", async () => {
    const user = await createTestViewer();
    createdUserIds.push(user.id);

    const account = await getMyAccount(user.id);

    expect(account.socialLinks).toEqual({});
  });

  it("round-trips a full social links replacement", async () => {
    const user = await createTestViewer();
    createdUserIds.push(user.id);

    const updated = await updateProfile(user.id, {
      socialLinks: { twitch: "https://twitch.tv/example", discord: "https://discord.gg/example" },
    });

    expect(updated.socialLinks).toEqual({
      twitch: "https://twitch.tv/example",
      discord: "https://discord.gg/example",
    });
  });

  it("leaves social links untouched when omitted from the update, matching displayName/bio's own COALESCE behavior", async () => {
    const user = await createTestViewer();
    createdUserIds.push(user.id);
    await updateProfile(user.id, { socialLinks: { youtube: "https://youtube.com/example" } });

    const updated = await updateProfile(user.id, { displayName: "New Name" });

    expect(updated.displayName).toBe("New Name");
    expect(updated.socialLinks).toEqual({ youtube: "https://youtube.com/example" });
  });

  it("replaces the whole social links map rather than merging per-key", async () => {
    const user = await createTestViewer();
    createdUserIds.push(user.id);
    await updateProfile(user.id, { socialLinks: { youtube: "https://youtube.com/example" } });

    const updated = await updateProfile(user.id, { socialLinks: { twitch: "https://twitch.tv/example" } });

    expect(updated.socialLinks).toEqual({ twitch: "https://twitch.tv/example" });
  });
});
