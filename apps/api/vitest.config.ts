import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 15_000,
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
