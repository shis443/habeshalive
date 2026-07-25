import { expect, test } from "@playwright/test";
import { getLatestOtpForEmail } from "./utils/otp";

test("a new user can sign up via email + OTP end to end", async ({ page }) => {
  const suffix = Date.now().toString();
  const email = `e2e_email_${suffix}@example.com`;
  const username = `e2e_email_${suffix.slice(-8)}`;

  await page.goto("/login");
  await expect(page.locator("#phone")).toBeVisible();

  await page.getByRole("button", { name: "Email" }).click();
  await expect(page.locator("#email")).toBeVisible();

  await page.fill("#email", email);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#code");

  const code = await getLatestOtpForEmail(email);

  await page.fill("#code", code);
  await page.fill("#username", username);
  await page.fill("#displayName", "Email E2E User");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/);

  // Confirms the session cookie actually carries the login, not just
  // client router state.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("wrong email OTP code is rejected", async ({ page }) => {
  const email = `e2e_email_wrong_${Date.now()}@example.com`;

  await page.goto("/login");
  await page.getByRole("button", { name: "Email" }).click();
  await page.fill("#email", email);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#code");

  await page.fill("#code", "000000");
  await page.click('button[type="submit"]');

  await expect(page.locator("text=/incorrect|expired|no code/i")).toBeVisible();
});
