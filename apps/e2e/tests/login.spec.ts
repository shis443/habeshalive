import { expect, test } from "@playwright/test";
import { signUpNewUser, uniquePhoneSuffix } from "./utils/auth";

test("a new user can sign up via phone + OTP end to end", async ({ page }) => {
  const user = await signUpNewUser(page);
  expect(page.url()).toContain("/dashboard");

  // Reloading a fresh page confirms the session cookie, not just client
  // router state, actually carries the login — the real thing this test
  // exists to prove.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);
  expect(user.userId).toBeTruthy();
});

test("wrong OTP code is rejected", async ({ page }) => {
  // A fresh number each run — reusing a fixed one would hit the app's own
  // 60s resend cooldown (apps/api/src/auth/service.ts) or the C1 rate
  // limiter (3 requests / 5 min) on repeated test runs.
  const phoneNumber = `+2519${uniquePhoneSuffix()}`;
  await page.goto("/login");
  await page.fill("#phone", phoneNumber);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#code");

  await page.fill("#code", "000000");
  await page.click('button[type="submit"]');

  await expect(page.locator("text=/incorrect|expired|no code/i")).toBeVisible();
});
