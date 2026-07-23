import { defineConfig } from "@playwright/test";

// Targets the running docker compose stack — these are E2E tests against
// real, already-running services (web on :3000, api on :4000), not tests
// that boot their own server. `docker compose up -d` must be running
// first; nothing here starts it (unlike Playwright's built-in
// webServer option, which assumes a single `npm run dev`-style command —
// this stack is 13 containers, not one process).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
