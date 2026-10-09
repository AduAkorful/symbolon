import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(import.meta.dirname) } },
  test: {
    // Default `pnpm test` is money and session only. Ask, UI, routes, audit scans
    // and the other app files stay in `web/test/` but are not run.
    include: [
      "test/access.test.ts",
      "test/approvals.test.ts",
      "test/business.test.ts",
      "test/compliance.test.ts",
      "test/connect-flow.test.ts",
      "test/delivery.test.ts",
      "test/format.test.ts",
      "test/invoice-send.test.ts",
      "test/load-config.test.ts",
      "test/orders.test.ts",
      "test/owner-signer.test.ts",
      "test/payee.test.ts",
      "test/payout-change.test.ts",
      "test/queued-change.test.ts",
      "test/session.test.ts",
      "test/treasury.test.ts",
      "test/verification.test.ts",
    ],
    isolate: false,
    fileParallelism: true,
    maxWorkers: 2,
    testTimeout: 15_000,
    hookTimeout: 60_000,
    setupFiles: ["test/setup.ts", "test/setup-shared.ts"],
  },
});
