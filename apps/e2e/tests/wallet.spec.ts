import { expect, test } from "@playwright/test";
import { signUpNewUser } from "./utils/auth";

test("a logged-in user sees their real wallet balance", async ({ page }) => {
  await signUpNewUser(page);

  await page.goto("/wallet");
  // A brand-new user has an empty wallet — this is the real balance from
  // GET /wallet/balance for the account just created, not a fixture.
  // "0.00 ETB" also appears in the weekly-delta line below it (exact
  // match, just two separate elements) — .first() is the balance figure
  // itself, confirmed by DOM order.
  await expect(page.getByText("0.00 ETB", { exact: true }).first()).toBeVisible();
});

test("an anonymous visitor is redirected away from /wallet", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page).toHaveURL(/\/login/);
});
