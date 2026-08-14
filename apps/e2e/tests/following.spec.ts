import { expect, test } from "@playwright/test";

test.describe("Following page", () => {
  test("redirects to login when not signed in", async ({ page }) => {
    const res = await page.goto("/following");
    // If the app redirects server-side to login, the final URL should include /login
    expect(page.url()).toContain("/login");
  });

  test("shows glass bottom nav and layout at mobile and desktop sizes", async ({ page }) => {
    // mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    // bottom nav is part of the layout; assert an element that typically exists
    const bottom = page.locator("nav[role='navigation']");
    await expect(bottom).toBeVisible();

    // desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(bottom).toBeVisible();
  });
});
