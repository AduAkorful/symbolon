import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // createTestDb reuses one migrated PGlite per file; files stay isolated so they do not share it
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
