import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // one PGlite, emptied between tests (this package has a single test file)
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
