import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, type Hex, type PublicClient } from "viem";
import { arcTestnet, getDeployment, invoiceLedgerAbi, type SymbolonContracts } from "@symbolon/chain";
import { chainEvents, createTestDb, decisions, invoices, syncCursors, businesses } from "@symbolon/db";
import { collectInvoiceHistory, syncLedger } from "../src/index.js";

const deployment = getDeployment(arcTestnet.id);
const ledger = deployment.contracts.invoiceLedger.toLowerCase();
const key = `ledger:${deployment.chainId}:${ledger}`;
const contracts = {} as SymbolonContracts;
const START = deployment.startBlock;
const T0 = 1_790_000_000n; // the time of the deployment's first block; one block per second after it
const timeOf = (n: bigint) => T0 + (n - START);

const fp = ("0x" + "ab".repeat(32)) as Hex;
const seal = "0x00000000000000000000000000000000000000a1";
const payer = "0x00000000000000000000000000000000000000b2";
const token = "0x00000000000000000000000000000000000000c3";
const payout = "0x00000000000000000000000000000000000000d4";

function chain(head: bigint, logsAt: Record<string, unknown[]> = {}) {
  const asked: [bigint, bigint][] = [];
  const client = {
    getBlockNumber: async () => head,
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: timeOf(blockNumber) })),
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      asked.push([fromBlock, toBlock]);
      return Object.entries(logsAt).flatMap(([block, logs]) => (BigInt(block) >= fromBlock && BigInt(block) <= toBlock ? logs : []));
    }),
    getTransactionReceipt: vi.fn(),
  } as unknown as PublicClient;
  return { client, asked };
}

async function addInvoice(db: Awaited<ReturnType<typeof createTestDb>>, opts: { receivedAt: Date; issuedAt?: Date | null; fingerprint?: Hex }) {
  await db.insert(invoices).values({
    fingerprint: opts.fingerprint ?? fp,
    chainId: deployment.chainId,
    ledger,
    seal,
    payerRef: "0x" + "ee".repeat(32),
    invoiceNumber: "INV-1",
    token,
    total: 1000n,
    dueDate: new Date(),
    envelope: "{}",
    source: "link",
    receivedAt: opts.receivedAt,
    issuedAt: opts.issuedAt ?? null,
    status: "verified",
  });
}

const settled = (block: bigint, credit: bigint, index = 0) => ({
  address: deployment.contracts.invoiceLedger,
  transactionHash: ("0x" + block.toString(16).padStart(64, "0")) as Hex,
  logIndex: index,
  blockNumber: block,
  eventName: "Settled",
  args: { fingerprint: fp, seal, payer, token, credit, paid: credit, discountBps: 0, payoutDomain: 26, payoutAddress: payout },
});

describe("where a ledger mirror with no cursor starts", () => {
  it("starts at the head when no invoice is known, saves that, and reads nothing", async () => {
    const db = await createTestDb();
    const head = START + 1_900_000n;
    const { client, asked } = chain(head);
    const run = await syncLedger(db, client, contracts, deployment, { maxBlocks: 200_000n });
    expect(asked).toEqual([]);
    expect(run.head).toBe(head);
    expect(run.to).toBeGreaterThanOrEqual(run.head); // nothing left behind
    const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, key));
    expect(cursor!.block).toBe(head);
    await db.$client.close();
  });

  it("starts a day before the earliest invoice instead of at the deployment's first block", async () => {
    const db = await createTestDb();
    const head = START + 1_900_000n;
    // an invoice received 1,000,000 seconds (= blocks) after the first block
    await addInvoice(db, { receivedAt: new Date(Number(T0 + 1_000_000n) * 1000) });
    const { client, asked } = chain(head);
    const run = await syncLedger(db, client, contracts, deployment, { maxBlocks: 200_000n });
    const expected = START + 1_000_000n - 86_400n;
    expect(run.from).toBeGreaterThanOrEqual(expected - 1n);
    expect(run.from).toBeLessThanOrEqual(expected + 1n);
    expect(Math.min(...asked.map((r) => Number(r[0])))).toBe(Number(run.from));
    await db.$client.close();
  });

  it("uses the earlier of the issue time and the received time", async () => {
    const db = await createTestDb();
    await addInvoice(db, { receivedAt: new Date(Number(T0 + 1_000_000n) * 1000), issuedAt: new Date(Number(T0 + 400_000n) * 1000) });
    const { client } = chain(START + 1_900_000n);
    const run = await syncLedger(db, client, contracts, deployment, { maxBlocks: 100_000n });
    expect(Number(run.from)).toBeLessThanOrEqual(Number(START + 400_000n - 86_400n) + 1);
    await db.$client.close();
  });

  it("never starts before the deployment, whatever date an invoice carries", async () => {
    const db = await createTestDb();
    await addInvoice(db, { receivedAt: new Date(), issuedAt: new Date(1_000_000_000_000) });
    const { client } = chain(START + 5_000n);
    const run = await syncLedger(db, client, contracts, deployment, { maxBlocks: 100_000n });
    expect(run.from).toBe(START);
    await db.$client.close();
  });
});

describe("collecting one invoice's payment history", () => {
  const credited = 1000n;

  it("returns the stored copy without any chain read when it already adds up", async () => {
    const db = await createTestDb();
    await addInvoice(db, { receivedAt: new Date(Number(T0) * 1000) });
    await db.insert(chainEvents).values({ chainId: deployment.chainId, txHash: "0x" + "99".repeat(32), logIndex: 0, blockNumber: START + 10n, address: ledger, eventName: "Settled", args: { ...settled(START + 10n, credited).args, credit: "1000", paid: "1000" } });
    const { client } = chain(START + 5_000n);
    const result = await collectInvoiceHistory(db, client, deployment, fp, credited);
    expect(result.complete).toBe(true);
    expect(client.getLogs).not.toHaveBeenCalled();
    expect(client.getBlockNumber).toBeDefined();
    await db.$client.close();
  });

  it("finds a payment older than the mirror's start from the invoice's own start, stores it, and does not look again", async () => {
    const db = await createTestDb();
    const head = START + 1_900_000n;
    const paidAt = START + 600_000n;
    // the invoice was received at block +590,000; the mirror was started at the head, so it has nothing
    await addInvoice(db, { receivedAt: new Date(Number(T0 + 590_000n) * 1000) });
    await db.insert(syncCursors).values({ key, chainId: deployment.chainId, block: head });
    const { client, asked } = chain(head, { [paidAt.toString()]: [settled(paidAt, credited)] });

    const first = await collectInvoiceHistory(db, client, deployment, fp, credited);
    expect(first.complete).toBe(true);
    expect(first.events.map((e) => e.blockNumber)).toEqual([paidAt]);
    expect(Math.min(...asked.map((r) => Number(r[0])))).toBeGreaterThan(Number(START + 500_000n)); // nothing before the invoice

    const [stored] = await db.select().from(chainEvents).where(eq(chainEvents.eventName, "Settled"));
    expect(stored).toMatchObject({ blockNumber: paidAt, address: ledger });
    expect((stored!.args as { seal: string }).seal).toBe(seal);

    (client.getLogs as ReturnType<typeof vi.fn>).mockClear();
    const second = await collectInvoiceHistory(db, client, deployment, fp, credited);
    expect(second.complete).toBe(true);
    expect(client.getLogs).not.toHaveBeenCalled();
    await db.$client.close();
  });

  it("reads the transaction this app recorded before searching any blocks", async () => {
    const db = await createTestDb();
    const head = START + 1_900_000n;
    await addInvoice(db, { receivedAt: new Date(Number(T0 + 590_000n) * 1000) });
    await db.insert(syncCursors).values({ key, chainId: deployment.chainId, block: head });
    const [biz] = await db.insert(businesses).values({ name: "Payer", chainId: deployment.chainId }).returning();
    const txHash = ("0x" + "5a".repeat(32)) as Hex;
    await db.insert(decisions).values({ businessId: biz!.id, kind: "pay", subject: fp, record: {}, hash: "0x" + "12".repeat(32), txHash });
    const { client } = chain(head);
    (client.getTransactionReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "success",
      logs: [
        {
          address: deployment.contracts.invoiceLedger,
          blockNumber: START + 600_000n,
          blockHash: "0x" + "00".repeat(32),
          transactionHash: txHash,
          transactionIndex: 0,
          logIndex: 2,
          removed: false,
          topics: encodeEventTopics({ abi: invoiceLedgerAbi, eventName: "Settled", args: { fingerprint: fp, seal, payer } }),
          data: encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "uint32" }, { type: "address" }],
            [token, credited, credited, 0, 26, payout],
          ),
        },
      ],
    });
    const result = await collectInvoiceHistory(db, client, deployment, fp, credited);
    expect(result.complete).toBe(true);
    expect(client.getLogs).not.toHaveBeenCalled();
    await db.$client.close();
  });

  it("reads only a budget of blocks from the invoice's start and then says so, when the payment is further away than that", async () => {
    const db = await createTestDb();
    const head = START + 1_900_000n;
    await addInvoice(db, { receivedAt: new Date(Number(T0 + 100_000n) * 1000) });
    await db.insert(syncCursors).values({ key, chainId: deployment.chainId, block: head });
    const paidAt = START + 900_000n;
    const { client, asked } = chain(head, { [paidAt.toString()]: [settled(paidAt, credited)] });
    const result = await collectInvoiceHistory(db, client, deployment, fp, credited);
    expect(result).toMatchObject({ complete: false, reason: "out_of_range", events: [] });
    const first = START + 100_000n - 86_400n;
    expect(Math.max(...asked.map((r) => Number(r[1])))).toBeLessThanOrEqual(Number(first + 400_000n));
    await db.$client.close();
  });

  it("says unreadable, and stores nothing, when the node can't be read", async () => {
    const db = await createTestDb();
    const head = START + 50_000n;
    await addInvoice(db, { receivedAt: new Date(Number(T0 + 10_000n) * 1000) });
    await db.insert(syncCursors).values({ key, chainId: deployment.chainId, block: head });
    const { client } = chain(head);
    (client.getLogs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rpc down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await collectInvoiceHistory(db, client, deployment, fp, credited);
    expect(result).toMatchObject({ complete: false, reason: "unreadable" });
    expect(await db.select().from(chainEvents)).toHaveLength(0);
    await db.$client.close();
  });
});
