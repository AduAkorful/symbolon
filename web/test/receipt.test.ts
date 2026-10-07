import { beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment, invoiceLedgerAbi } from "@symbolon/chain";
import { businesses, chainEvents, createTestDb, invoices, syncCursors } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice } from "@symbolon/seal";
import type { Hex, PublicClient } from "viem";

vi.mock("server-only", () => ({}));

import { DEFAULT_HISTORY_LIMITS } from "@symbolon/core";
import { loadReceipt } from "@/lib/server/receipt";
import { syncKey } from "@/lib/server/sync";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
};

const sealKey = privateKeyToAccount(generatePrivateKey());
const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const randHash = () => ("0x" + "b".repeat(64)) as Hex;

async function createInvoiceEnvelope(vault: string, number: string) {
  const document = completeTotals({
    schema: "symbolon.invoice.v1",
    seal: sealKey.address.toLowerCase(),
    vendor: { name: "Design Studio" },
    payer: { name: "Client Corp", vault },
    invoiceNumber: number,
    issuedAt: 1_790_000_000,
    dueDate: 1_792_592_000,
    currency: {
      chainId: cfg.chainId,
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      symbol: "USDC",
      decimals: 6,
    },
    lineItems: [{ description: "Design Work", quantity: "1", unitPrice: "2500" }],
    taxes: [],
    discounts: [],
    payout: { address: randAddr(), domain: 26 },
    earlyPay: [],
    attachments: [],
  } as never);

  const { sealed, fingerprint } = await sealInvoice({
    signer: sealKey,
    chainId: cfg.chainId,
    ledger: cfg.deployment.contracts.invoiceLedger,
    document,
  });
  return { sealed, envelope: encodeSealedInvoice(sealed), fingerprint };
}

describe("Receipts Service", () => {
  it("returns null for unknown fingerprint", async () => {
    const client = {} as PublicClient;
    const res = await loadReceipt(db, client, cfg, "0x0000000000000000000000000000000000000000000000000000000000000000");
    expect(res).toBeNull();
  });

  async function paidInvoice(number: string, total = 2500_000_000n, credited = total) {
    const vault = randAddr();
    const { sealed, envelope, fingerprint } = await createInvoiceEnvelope(vault, number);
    const [biz] = await db.insert(businesses).values({ name: `Receipt payer ${number}`, chainId: cfg.chainId, vault, vaultBlock: 1000n, stewardWallet: randAddr() }).returning();
    await db.insert(invoices).values({
      businessId: biz!.id,
      fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: number,
      envelope,
      total,
      credited,
      receivedAt: new Date(),
      status: "paid",
    });
    return { vault, sealed, fingerprint, total };
  }

  const ledger = cfg.deployment.contracts.invoiceLedger.toLowerCase();
  const settledArgs = (fingerprint: string, sealAddr: string, vault: string, credit: bigint, paid: bigint, discountBps = 0) => ({
    fingerprint,
    seal: sealAddr,
    payer: vault,
    token: cfg.deployment.tokens.usdc,
    credit: credit.toString(),
    paid: paid.toString(),
    discountBps,
    payoutDomain: 26,
    payoutAddress: randAddr(),
  });

  /** A client that answers the ledger's own balance reads and counts every log request */
  function chain(opts: { credited: bigint; total: bigint; head?: bigint; logs?: unknown[] }) {
    const getLogs = vi.fn().mockResolvedValue(opts.logs ?? []);
    const client = {
      readContract: vi.fn().mockImplementation(async ({ functionName }) =>
        functionName === "remaining" ? opts.total - opts.credited : { seen: true, cancelled: false, total: opts.total, credited: opts.credited },
      ),
      getBlockNumber: vi.fn().mockResolvedValue(opts.head ?? 64060500n),
      getLogs,
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_790_100_000n }),
    } as unknown as PublicClient;
    return { client, getLogs };
  }

  it("lists settlements from the stored copy of the ledger's events, with no scan of the chain (A2)", async () => {
    const inv = await paidInvoice("INV-RCPT-1");
    await db.insert(chainEvents).values({
      chainId: cfg.chainId,
      txHash: "0x" + "ab".repeat(32),
      logIndex: 3,
      blockNumber: 64060470n,
      blockTime: new Date(1_790_100_000_000),
      address: ledger,
      eventName: "Settled",
      args: settledArgs(inv.fingerprint, inv.sealed.document.seal, inv.vault, 2500_000_000n, 2470_000_000n, 120),
    });
    // an unrelated invoice's event and a Vault event must not leak into this receipt
    await db.insert(chainEvents).values({ chainId: cfg.chainId, txHash: "0x" + "cd".repeat(32), logIndex: 0, blockNumber: 64060471n, address: ledger, eventName: "Settled", args: settledArgs("0x" + "9".repeat(64), inv.sealed.document.seal, inv.vault, 1n, 1n) });

    const { client, getLogs } = chain({ credited: 2500_000_000n, total: 2500_000_000n });
    const receipt = await loadReceipt(db, client, cfg, inv.fingerprint);

    expect(getLogs).not.toHaveBeenCalled();
    expect(receipt?.state).toBe("settled");
    if (receipt && receipt.state === "settled") {
      expect(receipt.invoiceNumber).toBe("INV-RCPT-1");
      expect(receipt.vendor.name).toBe("Design Studio");
      expect(receipt.settlements).toHaveLength(1);
      expect(receipt.settlements[0]!.txHash).toBe("0x" + "ab".repeat(32));
      expect(receipt.settlements[0]!.discountBps).toBe(120);
      expect(receipt.settlements[0]!.timestamp?.getTime()).toBe(1_790_100_000_000);
      expect(receipt.totalPaidFormatted).toBe("2470.000000");
      expect(receipt.totalCreditFormatted).toBe("2500.000000");
      expect(receipt.isFullyPaid).toBe(true);
    }
  });

  it("reads only the few blocks after the stored copy when it is slightly behind, and lists both (A2)", async () => {
    const inv = await paidInvoice("INV-RCPT-2");
    await db.insert(chainEvents).values({ chainId: cfg.chainId, txHash: "0x" + "a1".repeat(32), logIndex: 0, blockNumber: 64060000n, blockTime: new Date(1_790_000_000_000), address: ledger, eventName: "Settled", args: settledArgs(inv.fingerprint, inv.sealed.document.seal, inv.vault, 1000_000_000n, 1000_000_000n) });
    await db.insert(syncCursors).values({ key: syncKey(cfg), chainId: cfg.chainId, block: 64060100n }).onConflictDoUpdate({ target: syncCursors.key, set: { block: 64060100n } });
    const tailLog = { transactionHash: "0x" + "b2".repeat(32), logIndex: 1, blockNumber: 64060400n, args: { fingerprint: inv.fingerprint, seal: inv.sealed.document.seal, payer: inv.vault, token: cfg.deployment.tokens.usdc, credit: 1500_000_000n, paid: 1500_000_000n, discountBps: 0, payoutDomain: 26, payoutAddress: randAddr() } };
    const { client, getLogs } = chain({ credited: 2500_000_000n, total: 2500_000_000n, head: 64060500n, logs: [tailLog] });

    const receipt = await loadReceipt(db, client, cfg, inv.fingerprint);
    expect(receipt?.state).toBe("settled");
    if (receipt?.state === "settled") expect(receipt.settlements.map((x) => x.creditFormatted)).toEqual(["1000.000000", "1500.000000"]);
    const asked = getLogs.mock.calls.map(([q]) => q as { fromBlock: bigint; toBlock: bigint });
    expect(Math.min(...asked.map((q) => Number(q.fromBlock)))).toBe(64060101);
    expect(Math.max(...asked.map((q) => Number(q.toBlock)))).toBe(64060500);
  });

  it("reads no more than its budget of blocks when the copy is far behind, and then says the records are still being collected (A2)", async () => {
    const inv = await paidInvoice("INV-RCPT-3");
    await db.insert(syncCursors).values({ key: syncKey(cfg), chainId: cfg.chainId, block: 1_000n }).onConflictDoUpdate({ target: syncCursors.key, set: { block: 1_000n } });
    const head = 1_000n + DEFAULT_HISTORY_LIMITS.maxTailBlocks + 5n;
    const { client, getLogs } = chain({ credited: 2500_000_000n, total: 2500_000_000n, head });
    const receipt = await loadReceipt(db, client, cfg, inv.fingerprint);
    expect(receipt).toMatchObject({ state: "unconfirmed" });
    if (receipt?.state === "unconfirmed") expect(receipt.reason).toMatch(/still being collected/);
    const asked = getLogs.mock.calls.map(([q]) => q as { fromBlock: bigint; toBlock: bigint });
    // never the stretch after the stale cursor in one go, never anywhere near the 1.95 million blocks since deployment
    expect(Math.max(...asked.map((q) => Number(q.toBlock))) - Math.min(...asked.map((q) => Number(q.fromBlock)))).toBeLessThanOrEqual(Number(DEFAULT_HISTORY_LIMITS.maxHistoryBlocks));
  });

  it("says it can't confirm when the records it finds don't add up to what the ledger credited (A2)", async () => {
    const inv = await paidInvoice("INV-RCPT-4");
    await db.insert(chainEvents).values({ chainId: cfg.chainId, txHash: "0x" + "c3".repeat(32), logIndex: 0, blockNumber: 64060000n, address: ledger, eventName: "Settled", args: settledArgs(inv.fingerprint, inv.sealed.document.seal, inv.vault, 1000_000_000n, 1000_000_000n) });
    await db.insert(syncCursors).values({ key: syncKey(cfg), chainId: cfg.chainId, block: 64060499n }).onConflictDoUpdate({ target: syncCursors.key, set: { block: 64060499n } });
    const { client } = chain({ credited: 2500_000_000n, total: 2500_000_000n, head: 64060500n, logs: [] });
    expect(await loadReceipt(db, client, cfg, inv.fingerprint)).toMatchObject({ state: "unconfirmed" });
  });

  it("does not search the chain again for the same invoice within a minute of coming up short (public pages are unauthenticated)", async () => {
    const inv = await paidInvoice("INV-RCPT-6");
    const { client, getLogs } = chain({ credited: 2500_000_000n, total: 2500_000_000n, head: 64060500n });
    expect(await loadReceipt(db, client, cfg, inv.fingerprint)).toMatchObject({ state: "unconfirmed" });
    const searched = getLogs.mock.calls.length;
    expect(searched).toBeGreaterThan(0);
    expect(await loadReceipt(db, client, cfg, inv.fingerprint)).toMatchObject({ state: "unconfirmed" });
    expect(getLogs.mock.calls.length).toBe(searched);
  });

  it("finds a payment that is older than the stored copy, saves it, and answers the next visit from the database (A2)", async () => {
    const inv = await paidInvoice("INV-RCPT-7");
    const old = {
      address: cfg.deployment.contracts.invoiceLedger,
      transactionHash: "0x" + "d4".repeat(32),
      logIndex: 2,
      blockNumber: 64060480n,
      args: { fingerprint: inv.fingerprint, seal: inv.sealed.document.seal, payer: inv.vault, token: cfg.deployment.tokens.usdc, credit: 2500_000_000n, paid: 2500_000_000n, discountBps: 0, payoutDomain: 26, payoutAddress: randAddr() },
    };
    await db.insert(syncCursors).values({ key: syncKey(cfg), chainId: cfg.chainId, block: 64060500n }).onConflictDoUpdate({ target: syncCursors.key, set: { block: 64060500n } });
    const { client, getLogs } = chain({ credited: 2500_000_000n, total: 2500_000_000n, head: 64060500n, logs: [old] });
    const first = await loadReceipt(db, client, cfg, inv.fingerprint);
    expect(first?.state).toBe("settled");
    getLogs.mockClear();
    const second = await loadReceipt(db, client, cfg, inv.fingerprint);
    expect(second?.state).toBe("settled");
    expect(getLogs).not.toHaveBeenCalled();
  });

  it("is a 404 when the ledger has credited nothing (A11), without any log request", async () => {
    const inv = await paidInvoice("INV-RCPT-5", 2500_000_000n, 0n);
    const { client, getLogs } = chain({ credited: 0n, total: 2500_000_000n });
    expect(await loadReceipt(db, client, cfg, inv.fingerprint)).toBeNull();
    expect(getLogs).not.toHaveBeenCalled();
  });
});
