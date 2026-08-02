import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
    // Vitest's own default `exclude` already lists dist/** — but setting
    // `test.exclude` at all (as this config already implicitly does by
    // existing) replaces that default rather than extending it, so dist
    // wasn't actually being excluded here. Found running the suite locally
    // after a `npm run build` (regenerates the gitignored dist/ — e.g.
    // before a manual flyctl deploy): the compiled dist/**/*.test.js files
    // got picked up as a second, stale copy of every test, still
    // referencing whatever the source looked like at build time (in this
    // case, gift type names a later migration had since renamed — real
    // failures, but from a ghost test file, not the actual source of truth
    // in src/). Listed explicitly rather than trusting a version-specific
    // default merge behavior.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**",
      "**/.{idea,cache,output,temp}/**",
    ],
    // These are real integration tests against a shared Postgres instance
    // (see test/setup.ts's comment — mocking SQL would test nothing
    // meaningful). Several suites touch the same singleton platform wallet
    // row (see wallet/service.test.ts's getPlatformWalletId), so multiple
    // test files racing against the DB concurrently (Vitest's default) can
    // read/write that shared row out of order. Serializing file execution
    // avoids that cross-file race; tests within a file still run in their
    // usual order.
    fileParallelism: false,
  },
});
