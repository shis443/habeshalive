import { createHmac, randomBytes } from "node:crypto";

// RFC 6238 (TOTP) built on RFC 4226 (HOTP) — hand-rolled against Node's
// built-in crypto rather than a new npm dependency (otpauth/speakeasy):
// this is exactly the kind of small, precisely-specified, security-
// critical primitive where fewer supply-chain dependencies is a real
// win, same reasoning as common/crypto.ts's AES-GCM implementation. The
// core HOTP function below is verified in totp.test.ts against RFC
// 4226 Appendix D's own published test vectors, not just "it compiles."

const STEP_SECONDS = 30;
const DIGITS = 6;
// Google Authenticator/Authy's own de facto standard, not from the RFC
// itself (which leaves secret length open) — 160 bits, RFC 4226's own
// recommended HOTP secret length ("MUST be at least 128 bits... 160
// bits is recommended").
const SECRET_BYTES = 20;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// RFC 4226 §5.3 dynamic truncation — takes a raw HMAC key (bytes, not
// base32) and a counter, returns a zero-padded DIGITS-length numeric
// code. This exact function is what totp.test.ts validates against the
// RFC's own Appendix D vectors.
function hotp(keyBytes: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac("sha1", keyBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, "0");
}

// base32 — the conventional wire format for TOTP secrets (what
// authenticator apps expect in an otpauth:// URI or manual-entry field).
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function buildOtpauthUri(base32Secret: string, accountLabel: string): string {
  const issuer = "BIRQ";
  const label = `${issuer}:${accountLabel}`;
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

// ±1 step (90s total window) to tolerate clock drift between the user's
// phone and this server — standard practice, matches every mainstream
// TOTP implementation's default.
const WINDOW_STEPS = 1;

export function verifyTotpCode(base32Secret: string, code: string, now: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const keyBytes = base32Decode(base32Secret);
  const currentCounter = Math.floor(now / 1000 / STEP_SECONDS);
  for (let drift = -WINDOW_STEPS; drift <= WINDOW_STEPS; drift++) {
    if (hotp(keyBytes, currentCounter + drift) === code) return true;
  }
  return false;
}

// Exported for totp.test.ts's RFC 4226 Appendix D vector validation —
// those vectors use the raw ASCII string "12345678901234567890" as the
// HMAC key directly (not base32-encoded), so the test needs the
// lower-level hotp() function, not the base32-wrapping verifyTotpCode().
export const __internal = { hotp, base32Encode, base32Decode };
