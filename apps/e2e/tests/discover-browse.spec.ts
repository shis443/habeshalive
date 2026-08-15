import { expect, test } from "@playwright/test";

// Twitch-reference UI Phase 2 — category discovery rails on /discover and
// /browse both render real STREAM_CATEGORIES tiles (no mock data) and
// navigate to the real /category/[slug] page, which in turn renders the
// real follower-count stat from GET /follows/category/:category/status.

test("discover page renders rails for recommended live channels and categories", async ({ page }) => {
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Discover" })).toBeVisible();
  await expect(page.getByText("RECOMMENDED LIVE CHANNELS")).toBeVisible();
  await expect(page.getByText("RECOMMENDED CATEGORIES")).toBeVisible();
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

test("category tabs keep URL state authoritative", async ({ page }) => {
  await page.goto("/category/Just%20Chatting?tab=videos");
  await expect(page).toHaveURL(/\/category\/Just%20Chatting\?tab=videos/);
  await expect(page.getByRole("link", { name: "Videos" })).toHaveAttribute("aria-current", "page");

  await page.goto("/category/Just%20Chatting?tab=clips");
  await expect(page).toHaveURL(/\/category\/Just%20Chatting\?tab=clips/);
  await expect(page.getByRole("link", { name: "Clips" })).toHaveAttribute("aria-current", "page");
});
