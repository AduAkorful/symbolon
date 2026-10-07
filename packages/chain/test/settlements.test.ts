import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex, type PublicClient } from "viem";

import { arcTestnet, blockAtOrBefore, collectSettlements, getDeployment, invoiceLedgerAbi, scanLogs, settlementsInTransactions } from "../src/index.js";

const deployment = getDeployment(arcTestnet.id);
const fp = ("0x" + "ab".repeat(32)) as Hex;
const seal = "0x00000000000000000000000000000000000000a1" as const;
const payer = "0x00000000000000000000000000000000000000b2" as const;
const token = "0x00000000000000000000000000000000000000c3" as const;
const payout = "0x00000000000000000000000000000000000000d4" as const;

/** One block per `step` seconds from `t0`, counted from block 1,000 */
const clock = (t0: bigint, step: bigint) =>
  vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: t0 + (blockNumber - 1_000n) * step }));

describe("blockAtOrBefore", () => {
  it("finds the newest block at or before a time in a handful of reads", async () => {
    const getBlock = clock(1_000_000n, 2n);
    const client = { getBlock, getBlockNumber: async () => 2_000_000n } as unknown as PublicClient;
    // block n is at 1,000,000 + 2 (n - 1000); 1,500,001 falls between blocks 251,000 (…000) and 251,001 (…002)
    const found = await blockAtOrBefore(client, 1_500_001n, { lo: 1_000n });
    expect(found).toBe(1_000n + 250_000n);
    expect(getBlock.mock.calls.length).toBeLessThan(12);
  });

  it("still finds it when block times are uneven (bisection takes over from interpolation)", async () => {
    // a long stall in the middle makes straight-line guesses poor
    const at = (n: bigint) => (n < 500_000n ? n : n < 600_000n ? 500_000n : n - 100_000n);
    const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: at(blockNumber) }));
    const client = { getBlock, getBlockNumber: async () => 1_000_000n } as unknown as PublicClient;
    const found = await blockAtOrBefore(client, 700_000n, { lo: 1_000n });
    expect(at(found)).toBeLessThanOrEqual(700_000n);
    expect(at(found + 1n)).toBeGreaterThan(700_000n);
    expect(getBlock.mock.calls.length).toBeLessThan(60);
  });

  it("returns the lower bound when the time is before it, and the head when the time is after it", async () => {
    const client = { getBlock: clock(1_000_000n, 2n), getBlockNumber: async () => 5_000n } as unknown as PublicClient;
    expect(await blockAtOrBefore(client, 5n, { lo: 1_000n })).toBe(1_000n);
    expect(await blockAtOrBefore(client, 9_999_999_999n, { lo: 1_000n })).toBe(5_000n);
  });
});

describe("scanLogs argument filter", () => {
  it("asks the node for one event with the indexed arguments, and refuses a filter for several events", async () => {
    const getLogs = vi.fn(async () => []);
    const client = { getLogs } as unknown as PublicClient;
    const events = [invoiceLedgerAbi.find((i) => i.type === "event" && i.name === "Settled")!] as never;
    await scanLogs(client, { address: deployment.contracts.invoiceLedger, events, args: { fingerprint: fp }, fromBlock: 1n, toBlock: 10n });
    expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ name: "Settled" }), args: { fingerprint: fp } }));
    await expect(scanLogs(client, { address: deployment.contracts.invoiceLedger, events: [] as never, args: { fingerprint: fp }, fromBlock: 1n, toBlock: 10n })).rejects.toThrow(/exactly one event/);
  });
});

const settledLog = (block: bigint, credit: bigint, forFp: Hex = fp, tx = `0x${block.toString(16).padStart(64, "0")}`) => ({
  address: deployment.contracts.invoiceLedger,
  transactionHash: tx as Hex,
  logIndex: 0,
  blockNumber: block,
  args: { fingerprint: forFp, seal, payer, token, credit, paid: credit, discountBps: 0, payoutDomain: 26, payoutAddress: payout },
});

describe("collectSettlements", () => {
  it("reads window by window from the start and stops as soon as the events add up to what was credited", async () => {
    const windows: [bigint, bigint][] = [];
    const getLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      windows.push([fromBlock, toBlock]);
      return fromBlock <= 150_000n && 150_000n <= toBlock ? [settledLog(150_000n, 700n)] : [];
    });
    const client = { getLogs } as unknown as PublicClient;
    const result = await collectSettlements(client, deployment, fp, { fromBlock: 100_000n, toBlock: 2_000_000n, credited: 700n, windowBlocks: 100_000n });
    expect(result.complete).toBe(true);
    expect(result.events.map((e) => e.credit)).toEqual([700n]);
    expect(Math.max(...windows.map((w) => Number(w[1])))).toBeLessThan(300_000); // never walked to the head
  });

  it("counts events it was given, returns only new ones, and drops an event for another invoice", async () => {
    const have = [{ ...settledLog(120_000n, 300n), seal, payer, token, credit: 300n, paid: 300n, discountBps: 0, payoutDomain: 26, payoutAddress: payout, txHash: "0x" + "11".repeat(32), blockNumber: 120_000n } as never];
    const getLogs = vi.fn(async () => [settledLog(130_000n, 200n), settledLog(131_000n, 999n, ("0x" + "cd".repeat(32)) as Hex)]);
    const client = { getLogs } as unknown as PublicClient;
    const result = await collectSettlements(client, deployment, fp, { fromBlock: 100_000n, toBlock: 150_000n, credited: 500n, have });
    expect(result.complete).toBe(true);
    expect(result.events.map((e) => e.credit)).toEqual([200n]);
  });

  it("says it is incomplete when the whole range is read and the events still fall short", async () => {
    const client = { getLogs: vi.fn(async () => [settledLog(130_000n, 200n)]) } as unknown as PublicClient;
    const result = await collectSettlements(client, deployment, fp, { fromBlock: 100_000n, toBlock: 150_000n, credited: 500n });
    expect(result).toMatchObject({ complete: false, scannedTo: 150_000n });
  });
});

describe("settlementsInTransactions", () => {
  const settledReceiptLog = (forFp: Hex, address = deployment.contracts.invoiceLedger) => ({
    address,
    blockNumber: 77n,
    blockHash: ("0x" + "00".repeat(32)) as Hex,
    transactionHash: ("0x" + "77".repeat(32)) as Hex,
    transactionIndex: 0,
    logIndex: 4,
    removed: false,
    topics: encodeEventTopics({ abi: invoiceLedgerAbi, eventName: "Settled", args: { fingerprint: forFp, seal, payer } }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "uint32" }, { type: "address" }],
      [token, 500n, 480n, 100, 26, payout],
    ),
  });

  it("reads this invoice's Settled event from a recorded transaction, and ignores other invoices, other contracts and failed transactions", async () => {
    const other = ("0x" + "cd".repeat(32)) as Hex;
    const receipts: Record<string, unknown> = {
      ["0x" + "01".repeat(32)]: { status: "success", logs: [settledReceiptLog(fp), settledReceiptLog(other), settledReceiptLog(fp, "0x00000000000000000000000000000000000000ee")] },
      ["0x" + "02".repeat(32)]: { status: "reverted", logs: [settledReceiptLog(fp)] },
    };
    const client = {
      getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => {
        if (!receipts[hash]) throw new Error("not found");
        return receipts[hash];
      }),
    } as unknown as PublicClient;
    const found = await settlementsInTransactions(client, deployment, fp, [("0x" + "01".repeat(32)) as Hex, ("0x" + "02".repeat(32)) as Hex, ("0x" + "03".repeat(32)) as Hex]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ credit: 500n, paid: 480n, discountBps: 100, payoutDomain: 26, logIndex: 4 });
  });
});
