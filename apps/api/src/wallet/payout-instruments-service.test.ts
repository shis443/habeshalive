import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../common/db.js";
import { cleanupTestUsers, createTestCreator, createTestViewer, type TestUser } from "../test/fixtures.js";
import {
  bindPayoutInstrument,
  getUsableVerifiedInstrument,
  rejectPayoutInstrument,
  retirePayoutInstrument,
  verifyPayoutInstrument,
} from "./payout-instruments-service.js";

// T7 acceptance criterion: a freshly bound instrument cannot receive a
// payout for 72 hours — this is the real-clock-advance test proving it,
// same "observe the real system, don't model it" pattern as T2's
// earning-holds clears_at tests: backdate the real usable_from column via
// direct SQL rather than mocking Date.now().

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

describe("bindPayoutInstrument", () => {
  it("stores only the last 4 digits as displayTail, never the full account number", async () => {
    const creator = await trackUser(await createTestCreator());

    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });

    expect(instrument.displayTail).toBe("4567");
    expect(instrument.status).toBe("unverified");

    const { rows } = await pool.query<{ encrypted_account_number: string; display_tail: string }>(
      `SELECT encrypted_account_number, display_tail FROM payout_instruments WHERE id = $1`,
      [instrument.id]
    );
    // The stored plaintext-adjacent column never contains the raw number —
    // this is the PCI-scope boundary the whole feature exists to hold.
    expect(rows[0]!.encrypted_account_number).not.toContain("0911234567");
    expect(rows[0]!.display_tail).toBe("4567");
  });

  it("rejects a bank instrument with no bankCode", async () => {
    const creator = await trackUser(await createTestCreator());

    await expect(
      bindPayoutInstrument(creator.id, {
        method: "bank",
        accountNumber: "1000123456789",
        accountHolder: "Test Creator",
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("getUsableVerifiedInstrument — the payout eligibility gate", () => {
  it("rejects an unverified instrument", async () => {
    const creator = await trackUser(await createTestCreator());
    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });

    await expect(getUsableVerifiedInstrument(creator.id, instrument.id)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects a verified instrument still inside its 72-hour cooling-off window", async () => {
    const creator = await trackUser(await createTestCreator());
    const admin = await trackUser(await createTestViewer());
    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });
    await verifyPayoutInstrument(admin.id, instrument.id);

    // usable_from defaults to now() + 72h (0060's migration) — untouched
    // here, so this instrument is verified but still cooling off.
    await expect(getUsableVerifiedInstrument(creator.id, instrument.id)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("accepts a verified instrument once usable_from has passed", async () => {
    const creator = await trackUser(await createTestCreator());
    const admin = await trackUser(await createTestViewer());
    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });
    await verifyPayoutInstrument(admin.id, instrument.id);

    // Real clock-advance via direct SQL, not a mocked clock — the same
    // 72-hour wait a real instrument would eventually clear on its own.
    await pool.query(`UPDATE payout_instruments SET usable_from = now() - interval '1 second' WHERE id = $1`, [
      instrument.id,
    ]);

    const usable = await getUsableVerifiedInstrument(creator.id, instrument.id);
    expect(usable.id).toBe(instrument.id);
    expect(usable.displayTail).toBe("4567");
  });

  it("rejects an instrument that belongs to a different creator", async () => {
    const creator = await trackUser(await createTestCreator());
    const otherCreator = await trackUser(await createTestCreator());
    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });

    await expect(getUsableVerifiedInstrument(otherCreator.id, instrument.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("admin review", () => {
  it("rejects verifying the same instrument twice", async () => {
    const creator = await trackUser(await createTestCreator());
    const admin = await trackUser(await createTestViewer());
    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });

    await verifyPayoutInstrument(admin.id, instrument.id);
    await expect(verifyPayoutInstrument(admin.id, instrument.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejectPayoutInstrument moves status to failed with a reason", async () => {
    const creator = await trackUser(await createTestCreator());
    const admin = await trackUser(await createTestViewer());
    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });

    await rejectPayoutInstrument(admin.id, instrument.id, "Name mismatch with KYC document");

    const { rows } = await pool.query<{ status: string }>(`SELECT status FROM payout_instruments WHERE id = $1`, [
      instrument.id,
    ]);
    expect(rows[0]!.status).toBe("failed");
  });

  it("retirePayoutInstrument makes a previously-usable instrument unusable again", async () => {
    const creator = await trackUser(await createTestCreator());
    const admin = await trackUser(await createTestViewer());
    const instrument = await bindPayoutInstrument(creator.id, {
      method: "telebirr",
      accountNumber: "0911234567",
      accountHolder: "Test Creator",
    });
    await verifyPayoutInstrument(admin.id, instrument.id);
    await pool.query(`UPDATE payout_instruments SET usable_from = now() - interval '1 second' WHERE id = $1`, [
      instrument.id,
    ]);

    await retirePayoutInstrument(creator.id, instrument.id);

    await expect(getUsableVerifiedInstrument(creator.id, instrument.id)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
