import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname) } },
  test: {
    include: ["test/**/*.test.ts"],
    isolate: false,
    fileParallelism: true,
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 60_000,
    setupFiles: ["test/setup.ts", "test/setup-shared.ts"],
  },
});
