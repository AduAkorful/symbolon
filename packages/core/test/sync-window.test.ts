import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { arcTestnet, getDeployment, type SymbolonContracts } from "@symbolon/chain";
import { createTestDb, invoices, syncCursors, type Database } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { syncLedger, syncVault } from "../src/index.js";

const deployment = getDeployment(arcTestnet.id);
const key = `ledger:${deployment.chainId}:${deployment.contracts.invoiceLedger.toLowerCase()}`;
const contracts = {} as SymbolonContracts;

function chainAt(head: bigint) {
  const ranges: [bigint, bigint][] = [];
  const client = {
    getBlockNumber: async () => head,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: 1_790_000_000n + blockNumber - deployment.startBlock }),
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]);
      return [];
    }),
  } as unknown as PublicClient;
  return { client, ranges };
}

/** A known invoice dated long ago, so a sync with no cursor starts at the deployment's first block */
async function knownOldInvoice(db: Database) {
  await db.insert(invoices).values({
    fingerprint: "0x" + "ab".repeat(32),
    chainId: deployment.chainId,
    ledger: deployment.contracts.invoiceLedger.toLowerCase(),
    seal: "0x00000000000000000000000000000000000000a1",
    payerRef: "0x" + "ee".repeat(32),
    invoiceNumber: "INV-OLD",
    token: "0x00000000000000000000000000000000000000c3",
    total: 1000n,
    dueDate: new Date(),
    envelope: "{}",
    source: "link",
    issuedAt: new Date(1_000_000),
    status: "verified",
  });
}

describe("ledger sync in bounded windows (A3)", () => {
  it("reads only one window from the cursor, saves the cursor there, and reports how far behind it is", async () => {
    const db = await createTestDb();
    const head = deployment.startBlock + 2_000_000n;
    await knownOldInvoice(db);
    const { client, ranges } = chainAt(head);

    const first = await syncLedger(db, client, contracts, deployment, { maxBlocks: 300_000n });
    expect(first).toMatchObject({ from: deployment.startBlock, to: deployment.startBlock + 299_999n, head });
    expect(Math.max(...ranges.map((r) => Number(r[1])))).toBe(Number(first.to));
    const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, key));
    expect(cursor!.block).toBe(first.to);

    // the next run continues where this one stopped, with no gap and no overlap
    const second = await syncLedger(db, client, contracts, deployment, { maxBlocks: 300_000n });
    expect(second.from).toBe(first.to + 1n);
    expect(second.to).toBe(first.to + 300_000n);
    await db.$client.close();
  });

  it("reads up to the head when the window is larger than what is left, and then has nothing to do", async () => {
    const db = await createTestDb();
    const head = deployment.startBlock + 5_000n;
    await knownOldInvoice(db);
    const { client } = chainAt(head);
    const run = await syncLedger(db, client, contracts, deployment, { maxBlocks: 300_000n });
    expect(run).toMatchObject({ to: head, head });
    const again = await syncLedger(db, client, contracts, deployment, { maxBlocks: 300_000n });
    expect(again).toMatchObject({ events: 0, head });
    expect(again.from).toBeGreaterThan(again.to);
    await db.$client.close();
  });

  it("keeps reading everything up to the head when no window is given (the scheduled job)", async () => {
    const db = await createTestDb();
    const head = deployment.startBlock + 50_000n;
    await knownOldInvoice(db);
    const { client } = chainAt(head);
    expect((await syncLedger(db, client, contracts, deployment)).to).toBe(head);
    await db.$client.close();
  });
});

describe("Vault event sync in bounded windows", () => {
  const vault = "0x00000000000000000000000000000000000000d1" as const;
  const vaultKey = `vault:${deployment.chainId}:${vault}`;

  it("reads one window from where it starts, saves the cursor there, and continues from it next time", async () => {
    const db = await createTestDb();
    const head = deployment.startBlock + 1_000_000n;
    const { client, ranges } = chainAt(head);
    const first = await syncVault(db, client, deployment, vault, { fromBlock: deployment.startBlock, maxBlocks: 100_000n });
    expect(first).toMatchObject({ from: deployment.startBlock, to: deployment.startBlock + 99_999n, head });
    expect(Math.max(...ranges.map((r) => Number(r[1])))).toBe(Number(first.to));
    const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, vaultKey));
    expect(cursor!.block).toBe(first.to);
    const second = await syncVault(db, client, deployment, vault, { maxBlocks: 100_000n });
    expect(second.from).toBe(first.to + 1n);
    await db.$client.close();
  });

  it("without a window still reads up to the head", async () => {
    const db = await createTestDb();
    const head = deployment.startBlock + 30_000n;
    const { client } = chainAt(head);
    const run = await syncVault(db, client, deployment, vault, { fromBlock: deployment.startBlock });
    expect(run).toMatchObject({ to: head, head });
    await db.$client.close();
  });
});
