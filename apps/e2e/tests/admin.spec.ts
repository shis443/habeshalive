import { expect, test } from "@playwright/test";
import { signUpNewUser } from "./utils/auth";
import { promoteToAdmin } from "./utils/db";
import { loginAs } from "./utils/session";

test("a regular user is redirected away from /admin", async ({ page }) => {
  await signUpNewUser(page);
  await page.goto("/admin");
  await expect(page).toHaveURL("/");
});

test("an admin sees the dashboard sections", async ({ page }) => {
  const user = await signUpNewUser(page);
  await promoteToAdmin(user.userId);

  // The signup helper's session cookie is still valid post-promotion, but
  // its JWT `role` claim was baked in at login time (see
  // apps/api/src/app.ts's requireAdmin decorator comment on this exact
  // staleness tradeoff) — mint a fresh one with the updated role.
  await loginAs(page.context(), user.userId, "admin");

  await page.goto("/admin");
  await expect(page.getByText("Pending payouts", { exact: true })).toBeVisible();
  await expect(page.getByText("Flagged content", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Open reports", { exact: true })).toBeVisible();
});
