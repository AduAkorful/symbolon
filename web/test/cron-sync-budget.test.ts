import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { createTestDb } from "@symbolon/db";

import { releaseSyncLease, runCronSync, takeSyncLease } from "@/lib/server/cron-sync";

// 17 Oct: the scheduled sync ran past Vercel's 120 s limit (FUNCTION_INVOCATION_TIMEOUT) on every monitor check

const deployment = getDeployment(arcTestnet.id);
const cfg = { chainId: deployment.chainId, deployment } as unknown as Parameters<typeof runCronSync>[2];

function client(getLogs: (args: { fromBlock: bigint; toBlock: bigint }) => Promise<unknown[]>) {
  return {
    getBlockNumber: async () => deployment.startBlock + 2_000_000n,
    getBlock: async () => ({ timestamp: 1_790_000_000n }),
    getLogs: vi.fn(getLogs),
  } as unknown as PublicClient;
}

describe("the scheduled sync answers within its time limit", () => {
  it("stops reading at the budget, saves progress, and says how far behind it still is", async () => {
    const db = await createTestDb();
    const c = client(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return [];
    });
    const started = Date.now();
    const report = await runCronSync(db, c, cfg, { budgetMs: 1_500, hardStopMs: 10_000 });
    // well before the hard stop: reading stopped at the budget, not at the limit
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(report.protocol).not.toHaveProperty("error");
    expect(report.done).toBe(false);
    expect(report.behindBlocks).toBeGreaterThan(0n);
    expect(report.protocol).toHaveProperty("streams");

    // the next run carries on from the saved cursors: the network history's first stream starts after where this one stopped
    const first = (report.protocol as { streams: { from: bigint; to: bigint }[] }).streams[0]!;
    const next = await runCronSync(db, c, cfg, { budgetMs: 1_500, hardStopMs: 10_000 });
    expect((next.protocol as { streams: { from: bigint }[] }).streams[0]!.from).toBe(first.to + 1n);
    await db.$client.close();
  });

  it("answers at the hard stop even when an RPC call never returns", async () => {
    const db = await createTestDb();
    const c = client(() => new Promise<unknown[]>(() => {}));
    const started = Date.now();
    const report = await runCronSync(db, c, cfg, { budgetMs: 50, hardStopMs: 300 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(report.protocol).toMatchObject({ error: expect.stringMatching(/time limit/) });
    expect(report.done).toBe(false);
    await db.$client.close();
  });

  it("lets only one run at a time, and the next run in once it lets go", async () => {
    const db = await createTestDb();
    expect(await takeSyncLease(db, deployment.chainId)).toBe(true);
    expect(await takeSyncLease(db, deployment.chainId)).toBe(false);
    await releaseSyncLease(db, deployment.chainId);
    expect(await takeSyncLease(db, deployment.chainId)).toBe(true);
    await db.$client.close();
  });
});
