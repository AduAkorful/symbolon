import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // each test boots an in-process Postgres (PGlite) and applies every migration
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
