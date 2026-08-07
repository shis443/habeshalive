import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

// AES-256-GCM (authenticated encryption — tampering with a stored value
// fails decryption outright, not just silently returns garbage, unlike
// plain AES-CBC) for encrypting stream_key at rest. Node's built-in
// crypto module — no new dependency for something this security-
// sensitive; fewer supply-chain surfaces to audit.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM's recommended nonce size (96 bits)
const AUTH_TAG_LENGTH = 16;

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const key = Buffer.from(env.STREAM_KEY_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      `STREAM_KEY_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256, got ${key.length}`
    );
  }
  cachedKey = key;
  return key;
}

// Output format: base64(iv[12] || authTag[16] || ciphertext). Self-
// describing and fixed-prefix-length, so decryptSecret needs no separate
// metadata store — the IV/tag travel with the ciphertext itself, the
// standard approach for GCM.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const raw = Buffer.from(encoded, "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted value too short to contain iv+authTag");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// creator_profiles.stream_key predates this encryption pass (the column
// itself is from db/migrations/0001_init.sql) — every pre-existing row is
// exactly 32 lowercase-hex characters (randomBytes(16).toString("hex"),
// video-provider.ts's real generation). Our own base64(iv+tag+ciphertext)
// output is always ~59+ characters for a 16-byte key — the fixed 32-char
// hex length alone is what the regex below actually checks, a cheap,
// deterministic distinguisher. Checked first, cheaply and
// deterministically, rather than attempting decryption and catching a
// throw — so a still-unmigrated row is never mistaken for a corrupted
// encrypted one. See docs/stream-key-encryption-rollout.md for the
// backfill this exists to bridge.
const LEGACY_PLAINTEXT_PATTERN = /^[0-9a-f]{32}$/;

export function resolveStreamKey(stored: string): string {
  if (LEGACY_PLAINTEXT_PATTERN.test(stored)) return stored;
  return decryptSecret(stored);
}

// Constant-time compare against a value that might still be legacy
// plaintext or already-encrypted — used at RTMP publish/unpublish time
// (streams/service.ts), the one place a mistiming leak would actually be
// exploitable (an attacker-controlled providedKey compared server-side).
export function timingSafeEqualStreamKey(providedKey: string | null, storedRaw: string): boolean {
  if (!providedKey) return false;
  const real = resolveStreamKey(storedRaw);
  const providedBuf = Buffer.from(providedKey);
  const realBuf = Buffer.from(real);
  return providedBuf.length === realBuf.length && timingSafeEqual(providedBuf, realBuf);
}
