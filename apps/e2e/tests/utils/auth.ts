import type { Page } from "@playwright/test";
import { getLatestOtpForPhone } from "./otp";

export interface SignedUpUser {
  userId: string;
  username: string;
  phoneNumber: string;
}

// Drives the real signup UI end to end (phone -> real OTP scraped from the
// dev SMS log -> code+profile -> verify) rather than seeding a user
// directly — this is the one test that exists specifically to prove the
// login flow itself works, not just that pages render for an
// already-authenticated session (see session.ts's loginAs for that).
export function uniquePhoneSuffix(): string {
  // Date.now() alone collides across parallel workers starting within the
  // same millisecond (observed live: a real 429 from either the app's OTP
  // resend cooldown or the C1 rate limiter when two tests picked the same
  // number) — a random component makes collisions astronomically unlikely
  // instead of merely unlikely.
  const rand = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `${Date.now().toString().slice(-2)}${rand}`;
}

export async function signUpNewUser(page: Page): Promise<SignedUpUser> {
  const suffix = uniquePhoneSuffix();
  const phoneNumber = `+2519${suffix}`;
  const username = `e2e_${suffix}`;

  await page.goto("/login");
  await page.fill("#phone", phoneNumber);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#code");

  const code = await getLatestOtpForPhone(phoneNumber);

  await page.fill("#code", code);
  await page.fill("#username", username);
  await page.fill("#displayName", "E2E Test User");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/);

  const me = await page.request.get("/api/backend/auth/me");
  const user = await me.json();

  return { userId: user.id, username, phoneNumber };
}
