import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../common/db.js";
import { AppError } from "../common/errors.js";
import { cleanupTestUsers, createTestViewer, type TestUser } from "../test/fixtures.js";
import { __internal } from "./totp.js";
import {
  computeDeviceFingerprint,
  confirmTotp,
  disableTotp,
  getTotpStatus,
  isTotpEnabled,
  recordLoginAndNotifyIfNewDevice,
  setupTotp,
  verifyTotpForLogin,
} from "./totp-service.js";

const createdUserIds: string[] = [];

async function trackUser<T extends TestUser>(user: T): Promise<T> {
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupTestUsers(createdUserIds);
  await pool.end();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// setupTotp/confirmTotp both go through totp.ts's own base32 encode/verify
// (already verified against RFC 4226's vectors in totp.test.ts) — this
// helper just needs a real, currently-valid code for whatever secret a
// given test's setup call actually returned, matching how a real
// authenticator app would produce one.
function currentCodeFor(secret: string): string {
  const keyBytes = __internal.base32Decode(secret);
  return __internal.hotp(keyBytes, Math.floor(Date.now() / 1000 / 30));
}

// Every recordLoginAndNotifyIfNewDevice test either doesn't reach a
// notification email (no email on file / returning device) or does, and
// env.RESEND_API_KEY is a real key loaded from repo-root .env by test/
// setup.ts — meaning emailGateway is the real ResendEmailGateway and would
// otherwise issue a genuine network call. Stubbed to a no-op success in
// every test that could reach it, matching moderation/actions-service.
// test.ts's stubEmptyFetch pattern.
function stubEmailFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "test-email-id" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("totp-service", () => {
  it("getTotpStatus/isTotpEnabled report false before any setup", async () => {
    const user = await trackUser(await createTestViewer());
    expect(await getTotpStatus(user.id)).toEqual({ enabled: false });
    expect(await isTotpEnabled(user.id)).toBe(false);
  });

  it("setupTotp stores a pending (disabled) secret, not yet enabled", async () => {
    const user = await trackUser(await createTestViewer());
    const { secret, otpauthUri } = await setupTotp(user.id, user.username);
    expect(secret).toMatch(/^[A-Z2-7]+$/); // RFC 4648 base32 alphabet
    expect(otpauthUri).toContain("otpauth://totp/");
    expect(otpauthUri).toContain(encodeURIComponent(user.username));
    expect(await isTotpEnabled(user.id)).toBe(false);
  });

  it("setupTotp called twice overwrites the still-pending secret harmlessly", async () => {
    const user = await trackUser(await createTestViewer());
    const first = await setupTotp(user.id, user.username);
    const second = await setupTotp(user.id, user.username);
    expect(second.secret).not.toBe(first.secret);
    // The old secret's code must no longer confirm — only the latest
    // pending secret is stored (ON CONFLICT DO UPDATE, not a second row).
    await expect(confirmTotp(user.id, currentCodeFor(first.secret))).rejects.toThrow(AppError);
  });

  it("confirmTotp with no prior setupTotp call is rejected", async () => {
    const user = await trackUser(await createTestViewer());
    await expect(confirmTotp(user.id, "000000")).rejects.toThrow(AppError);
    await expect(confirmTotp(user.id, "000000")).rejects.toThrow(/setup first/);
  });

  it("confirmTotp with a wrong code does not enable 2FA", async () => {
    const user = await trackUser(await createTestViewer());
    const { secret } = await setupTotp(user.id, user.username);
    const wrongCode = currentCodeFor(secret) === "111111" ? "222222" : "111111";
    await expect(confirmTotp(user.id, wrongCode)).rejects.toThrow(/Invalid code/);
    expect(await isTotpEnabled(user.id)).toBe(false);
  });

  it("confirmTotp with the real current code enables 2FA", async () => {
    const user = await trackUser(await createTestViewer());
    const { secret } = await setupTotp(user.id, user.username);
    await confirmTotp(user.id, currentCodeFor(secret));
    expect(await isTotpEnabled(user.id)).toBe(true);
  });

  it("confirmTotp rejects re-confirming an already-enabled secret", async () => {
    const user = await trackUser(await createTestViewer());
    const { secret } = await setupTotp(user.id, user.username);
    await confirmTotp(user.id, currentCodeFor(secret));
    await expect(confirmTotp(user.id, currentCodeFor(secret))).rejects.toThrow(/already enabled/);
  });

  it("verifyTotpForLogin: false for a user with no 2FA set up at all", async () => {
    const user = await trackUser(await createTestViewer());
    expect(await verifyTotpForLogin(user.id, "123456")).toBe(false);
  });

  it("verifyTotpForLogin: false while the secret is still pending (unconfirmed)", async () => {
    const user = await trackUser(await createTestViewer());
    const { secret } = await setupTotp(user.id, user.username);
    // The code is real and would pass confirmTotp, but login verification
    // must only ever trust an *enabled* secret.
    expect(await verifyTotpForLogin(user.id, currentCodeFor(secret))).toBe(false);
  });

  it("verifyTotpForLogin: true for a real code once enabled, false for a wrong one", async () => {
    const user = await trackUser(await createTestViewer());
    const { secret } = await setupTotp(user.id, user.username);
    await confirmTotp(user.id, currentCodeFor(secret));

    expect(await verifyTotpForLogin(user.id, currentCodeFor(secret))).toBe(true);
    const wrongCode = currentCodeFor(secret) === "654321" ? "123456" : "654321";
    expect(await verifyTotpForLogin(user.id, wrongCode)).toBe(false);
  });

  it("disableTotp requires 2FA to already be enabled", async () => {
    const user = await trackUser(await createTestViewer());
    await expect(disableTotp(user.id, "123456")).rejects.toThrow(/not enabled/);
  });

  it("disableTotp rejects a wrong code and leaves 2FA enabled", async () => {
    const user = await trackUser(await createTestViewer());
    const { secret } = await setupTotp(user.id, user.username);
    await confirmTotp(user.id, currentCodeFor(secret));

    const wrongCode = currentCodeFor(secret) === "000001" ? "000002" : "000001";
    await expect(disableTotp(user.id, wrongCode)).rejects.toThrow(/Invalid code/);
    expect(await isTotpEnabled(user.id)).toBe(true);
  });

  it("disableTotp with the real code removes the row entirely (re-setup possible after)", async () => {
    const user = await trackUser(await createTestViewer());
    const { secret } = await setupTotp(user.id, user.username);
    await confirmTotp(user.id, currentCodeFor(secret));

    await disableTotp(user.id, currentCodeFor(secret));
    expect(await isTotpEnabled(user.id)).toBe(false);
    expect(await verifyTotpForLogin(user.id, currentCodeFor(secret))).toBe(false);

    // A fresh setup -> confirm cycle must work again post-disable.
    const { secret: secret2 } = await setupTotp(user.id, user.username);
    await confirmTotp(user.id, currentCodeFor(secret2));
    expect(await isTotpEnabled(user.id)).toBe(true);
  });

  it("computeDeviceFingerprint is deterministic for the same input and differs across IP or UA", () => {
    const a = computeDeviceFingerprint("1.2.3.4", "Mozilla/5.0 Chrome/120");
    const b = computeDeviceFingerprint("1.2.3.4", "Mozilla/5.0 Chrome/120");
    const differentIp = computeDeviceFingerprint("5.6.7.8", "Mozilla/5.0 Chrome/120");
    const differentUa = computeDeviceFingerprint("1.2.3.4", "Mozilla/5.0 Safari/17");
    expect(a).toBe(b);
    expect(a).not.toBe(differentIp);
    expect(a).not.toBe(differentUa);
  });

  it("recordLoginAndNotifyIfNewDevice: first login from a device with no email on file sends no email and doesn't throw", async () => {
    const user = await trackUser(await createTestViewer());
    const fetchMock = stubEmailFetch();
    await recordLoginAndNotifyIfNewDevice(user.id, "9.9.9.9", "test-agent/1.0");
    expect(fetchMock).not.toHaveBeenCalled();

    const { rows } = await pool.query<{ device_fingerprint: string }>(
      `SELECT device_fingerprint FROM login_events WHERE user_id = $1`,
      [user.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.device_fingerprint).toBe(computeDeviceFingerprint("9.9.9.9", "test-agent/1.0"));
  });

  it("recordLoginAndNotifyIfNewDevice: new device + an email on file sends exactly one notification email", async () => {
    const user = await trackUser(await createTestViewer());
    await pool.query(`UPDATE users SET email = $2 WHERE id = $1`, [user.id, `${user.username}@example.com`]);
    const fetchMock = stubEmailFetch();

    await recordLoginAndNotifyIfNewDevice(user.id, "10.10.10.10", "test-agent/1.0");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse((options as { body: string }).body);
    expect(body.to).toBe(`${user.username}@example.com`);
    expect(body.subject).toMatch(/new login/i);
  });

  it("recordLoginAndNotifyIfNewDevice: same device seen again does not re-notify", async () => {
    const user = await trackUser(await createTestViewer());
    await pool.query(`UPDATE users SET email = $2 WHERE id = $1`, [user.id, `${user.username}@example.com`]);

    stubEmailFetch();
    await recordLoginAndNotifyIfNewDevice(user.id, "11.11.11.11", "test-agent/1.0");

    const fetchMock = stubEmailFetch();
    await recordLoginAndNotifyIfNewDevice(user.id, "11.11.11.11", "test-agent/1.0");
    expect(fetchMock).not.toHaveBeenCalled();

    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM login_events WHERE user_id = $1`, [user.id]);
    expect(rows).toHaveLength(2); // both attempts are still audited...
  });

  it("recordLoginAndNotifyIfNewDevice: a different device for the same user does re-notify", async () => {
    const user = await trackUser(await createTestViewer());
    await pool.query(`UPDATE users SET email = $2 WHERE id = $1`, [user.id, `${user.username}@example.com`]);

    stubEmailFetch();
    await recordLoginAndNotifyIfNewDevice(user.id, "12.12.12.12", "device-A");

    const fetchMock = stubEmailFetch();
    await recordLoginAndNotifyIfNewDevice(user.id, "12.12.12.12", "device-B");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recordLoginAndNotifyIfNewDevice never throws even if the email send fails", async () => {
    const user = await trackUser(await createTestViewer());
    await pool.query(`UPDATE users SET email = $2 WHERE id = $1`, [user.id, `${user.username}@example.com`]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }))
    );

    await expect(recordLoginAndNotifyIfNewDevice(user.id, "13.13.13.13", "test-agent/1.0")).resolves.toBeUndefined();
  });
});
