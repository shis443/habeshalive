import { expect, test } from "@playwright/test";

test("search with no query prompts for one", async ({ page }) => {
  await page.goto("/search");
  await expect(page.getByText("Search for a stream title or creator")).toBeVisible();
});

test("search with a query that matches nothing shows an empty state", async ({ page }) => {
  await page.goto("/search?q=zzz_definitely_no_match_zzz");
  await expect(page.getByText("No live streams or creators matched")).toBeVisible();
});
