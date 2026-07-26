import { expect, test } from "@playwright/test";

test("homepage loads and shows the wordmark", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Birq", { exact: true }).first()).toBeVisible();
});

test("homepage exposes a PWA manifest", async ({ page }) => {
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.name).toBe("Birq");
});
