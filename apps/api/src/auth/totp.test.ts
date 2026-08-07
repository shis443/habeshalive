import { describe, expect, it } from "vitest";
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode, __internal } from "./totp.js";

const { hotp, base32Encode, base32Decode } = __internal;

// RFC 4226 Appendix D's own published test vectors — the canonical,
// widely-reproduced values every real HOTP/TOTP implementation is
// checked against. Secret is the raw ASCII string "12345678901234567890"
// used directly as HMAC key bytes (the RFC's own convention for these
// vectors — not base32-encoded).
describe("hotp (RFC 4226 Appendix D vectors)", () => {
  const key = Buffer.from("12345678901234567890", "ascii");
  const expected = [
    "755224",
    "287082",
    "359152",
    "969429",
    "338314",
    "254676",
    "287922",
    "162583",
    "399871",
    "520489",
  ];

  it.each(expected.map((code, counter) => [counter, code] as const))(
    "counter=%i produces %s",
    (counter, code) => {
      expect(hotp(key, counter)).toBe(code);
    }
  );
});

describe("base32Encode / base32Decode", () => {
  it("round-trips arbitrary bytes", () => {
    for (const input of [Buffer.from([]), Buffer.from([0]), Buffer.from("hello world"), Buffer.alloc(20, 0xff)]) {
      expect(base32Decode(base32Encode(input))).toEqual(input);
    }
  });

  it("round-trips a real generated secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const decoded = base32Decode(secret);
    expect(decoded.length).toBe(20); // SECRET_BYTES
  });
});

describe("verifyTotpCode", () => {
  it("accepts the correct current code", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const counter = Math.floor(now / 1000 / 30);
    const key = base32Decode(secret);
    const code = hotp(key, counter);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "000000", Date.now())).toBe(false);
  });

  it("tolerates ±1 step of clock drift", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const key = base32Decode(secret);
    const counter = Math.floor(now / 1000 / 30);
    const codeOneStepAhead = hotp(key, counter + 1);
    // Simulate the *server* clock being 30s behind the code's step —
    // verifying "now" should still accept a code generated 1 step ahead.
    expect(verifyTotpCode(secret, codeOneStepAhead, now)).toBe(true);
  });

  it("rejects a code 2 steps outside the drift window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const key = base32Decode(secret);
    const counter = Math.floor(now / 1000 / 30);
    const codeTwoStepsAhead = hotp(key, counter + 2);
    expect(verifyTotpCode(secret, codeTwoStepsAhead, now)).toBe(false);
  });

  it("rejects malformed input (non-6-digit)", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "12345", Date.now())).toBe(false);
    expect(verifyTotpCode(secret, "1234567", Date.now())).toBe(false);
    expect(verifyTotpCode(secret, "abcdef", Date.now())).toBe(false);
  });
});

describe("buildOtpauthUri", () => {
  it("produces a real otpauth:// URI with the expected parameters", () => {
    const uri = buildOtpauthUri("JBSWY3DPEHPK3PXP", "shis@birq.live");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    const parsed = new URL(uri);
    expect(parsed.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(parsed.searchParams.get("issuer")).toBe("BIRQ");
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
  });
});
