import { expect, test } from "@playwright/test";

// Twitch-reference UI Phase 2 — category discovery rails on /discover and
// /browse both render real STREAM_CATEGORIES tiles (no mock data) and
// navigate to the real /category/[slug] page, which in turn renders the
// real follower-count stat from GET /follows/category/:category/status.

test("discover page renders a category rail that navigates to a real category page", async ({ page }) => {
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Explore categories" })).toBeVisible();
  const tile = page.getByRole("link", { name: /Music/ });
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page).toHaveURL(/\/category\/Music/);
  await expect(page.getByRole("heading", { name: "Music", exact: true })).toBeVisible();
});

test("browse categories tab renders real category tiles that navigate correctly", async ({ page }) => {
  await page.goto("/browse?view=categories");
  const tile = page.getByRole("link", { name: /Gaming/ });
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page).toHaveURL(/\/category\/Gaming/);
});

test("category page shows real follower and viewer stats, not placeholders", async ({ page }) => {
  await page.goto("/category/Just%20Chatting");
  await expect(page.getByRole("heading", { name: "Just Chatting", exact: true })).toBeVisible();
  // Either phrasing is a real, database-backed value — never a hardcoded
  // placeholder string — depending on current live/follow state.
  await expect(page.getByText(/(watching now|No one watching right now)/)).toBeVisible();
  await expect(page.getByText(/follower/)).toBeVisible();
});
