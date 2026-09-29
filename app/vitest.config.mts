import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname) } },
  // PGlite starts a database in `beforeAll`; on a busy machine that takes longer than the 10s default
  test: { include: ["test/**/*.test.ts"], hookTimeout: 60_000 },
});
