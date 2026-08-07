import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, resolveStreamKey, timingSafeEqualStreamKey } from "./crypto.js";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a real plaintext value", () => {
    const plaintext = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"; // shape of a real generated stream key
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random IV), even for the same plaintext", () => {
    const plaintext = "same-value-both-times";
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it("rejects a tampered ciphertext instead of silently returning garbage", () => {
    const encrypted = encryptSecret("real-secret-value");
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff; // flip the last ciphertext byte
    const tampered = raw.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("resolveStreamKey (dual-compat with pre-encryption legacy rows)", () => {
  it("returns a legacy plaintext row (32 lowercase hex chars, randomBytes(16).toString('hex')'s real shape) unchanged", () => {
    const legacy = "0123456789abcdef0123456789abcde0";
    expect(legacy).toHaveLength(32);
    expect(resolveStreamKey(legacy)).toBe(legacy);
  });

  it("decrypts a real encrypted row", () => {
    const plaintext = "freshly-generated-key-abc123";
    const encrypted = encryptSecret(plaintext);
    expect(resolveStreamKey(encrypted)).toBe(plaintext);
  });
});

describe("timingSafeEqualStreamKey", () => {
  it("matches a provided plaintext key against an encrypted stored value", () => {
    const plaintext = "real-key-value-123";
    const stored = encryptSecret(plaintext);
    expect(timingSafeEqualStreamKey(plaintext, stored)).toBe(true);
  });

  it("matches a provided plaintext key against a legacy plaintext stored value", () => {
    const legacy = "abcdef0123456789abcdef0123456789";
    const real = legacy.slice(0, 32);
    expect(timingSafeEqualStreamKey(real, real)).toBe(true);
  });

  it("rejects the wrong key", () => {
    const stored = encryptSecret("correct-key");
    expect(timingSafeEqualStreamKey("wrong-key", stored)).toBe(false);
  });

  it("rejects a null provided key", () => {
    const stored = encryptSecret("correct-key");
    expect(timingSafeEqualStreamKey(null, stored)).toBe(false);
  });
});
