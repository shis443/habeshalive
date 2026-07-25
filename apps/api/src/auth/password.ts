import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Same salt:hash scrypt pattern as otp.ts's hashCode/verifyCodeHash — proven
// in this codebase already, no reason to introduce a different scheme (or a
// new dependency like bcrypt/argon2) just for passwords. Node's scryptSync
// defaults (N=16384, r=8, p=1) are a widely-accepted adequate cost factor
// for password hashing, not just OTP codes.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
