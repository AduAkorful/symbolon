import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";

import { arcTestnet, getDeployment } from "@symbolon/chain";
import { loadConfig } from "@symbolon/config";
import { createTestDb } from "@symbolon/db";

import { runIndexerTick } from "../src/indexer.js";
import { releaseSyncLease, takeSyncLease } from "../src/lease.js";

const deployment = getDeployment(arcTestnet.id);

function client(getLogs: (args: { fromBlock: bigint; toBlock: bigint }) => Promise<unknown[]>) {
  return {
    getBlockNumber: async () => deployment.startBlock + 2_000_000n,
    getBlock: async () => ({ timestamp: 1_790_000_000n }),
    getLogs: vi.fn(getLogs),
  } as unknown as PublicClient;
}

function cfg() {
  return loadConfig({ CHAIN_ID: String(arcTestnet.id), APP_ORIGIN: "http://localhost:3000" });
}

describe("indexer tick", () => {
  it("moves one window and the next tick continues from the saved cursor", async () => {
    const db = await createTestDb();
    const c = client(async () => []);
    const report = await runIndexerTick(db, c, cfg());
    expect(report.done).toBe(false);
    expect(report.behindBlocks).toBeGreaterThan(0n);
    expect(report.protocol).toHaveProperty("streams");
    const first = (report.protocol as { streams: { from: bigint; to: bigint }[] }).streams[0]!;
    const next = await runIndexerTick(db, c, cfg());
    expect((next.protocol as { streams: { from: bigint }[] }).streams[0]!.from).toBe(first.to + 1n);
    await db.$client.close();
  });

  it("lets only one tick hold the lease", async () => {
    const db = await createTestDb();
    expect(await takeSyncLease(db, deployment.chainId)).toBe(true);
    expect(await takeSyncLease(db, deployment.chainId)).toBe(false);
    await releaseSyncLease(db, deployment.chainId);
    expect(await takeSyncLease(db, deployment.chainId)).toBe(true);
    await db.$client.close();
  });
});
