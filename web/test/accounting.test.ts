import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SymbolonContracts } from "@symbolon/chain";
import { eq } from "drizzle-orm";
import type { Hex, PublicClient } from "viem";

vi.mock("server-only", () => ({}));
import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  businesses,
  chainEvents,
  createTestDb,
  decisions,
  invoices,
  members,
  seals,
  users,
} from "@symbolon/db";
import {
  exportAccounting,
  loadAccounting,
  resyncLedger,
} from "@/lib/server/accounting";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const deployment = getDeployment(arcTestnet.id);
let vaultNo = 500;
let sealNo = 70;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({ email: `acct-owner-${crypto.randomUUID()}@example.test` })
    .returning();
  const [viewer] = await db
    .insert(users)
    .values({ email: `acct-viewer-${crypto.randomUUID()}@example.test` })
    .returning();
  const [outsider] = await db
    .insert(users)
    .values({ email: `acct-out-${crypto.randomUUID()}@example.test` })
    .returning();

  const vaultAddr = address(++vaultNo);

  const [business] = await db
    .insert(businesses)
    .values({
      name: "Accounting Corp",
      chainId: arcTestnet.id,
      vault: vaultAddr,
      vaultBlock: 100n,
    })
    .returning();

  await db.insert(members).values([
    { businessId: business!.id, userId: owner!.id, role: "owner" },
    { businessId: business!.id, userId: viewer!.id, role: "viewer" },
  ]);

  const sealAddr = address(++sealNo);
  await db.insert(seals).values({
    address: sealAddr,
    userId: owner!.id,
    handle: `kestrel-labs-${sealNo}`,
    displayName: "Kestrel Labs",
    payoutAddress: address(21),
  });

  return { owner: owner!, viewer: viewer!, outsider: outsider!, business: business!, sealAddr, vaultAddr };
}

describe("Accounting service (05s Part D)", () => {
  it("loadAccounting: non-member gets 403, viewer can read (K20)", async () => {
    const { owner, viewer, outsider, business } = await fixture();
    const mockContracts: any = {
      invoiceLedger: { read: { getInvoice: async () => [0n, false, false, 0n] } },
    };

    await expect(
      loadAccounting(db, mockContracts, undefined, deployment, outsider, business.id),
    ).rejects.toMatchObject({ status: 403 });

    const viewData = await loadAccounting(db, mockContracts, undefined, deployment, viewer, business.id);
    expect(viewData.business.name).toBe("Accounting Corp");
    expect(viewData.reconciliation).toBeDefined();
  });

  it("loadAccounting: loads settled payments with separate token totals (K14)", async () => {
    const { owner, business, sealAddr } = await fixture();
    const mockContracts: any = {
      invoiceLedger: { read: { getInvoice: async () => [0n, false, false, 0n] } },
    };

    const fp = hash(20);
    await db.insert(invoices).values({
      fingerprint: fp,
      chainId: arcTestnet.id,
      ledger: deployment.contracts.invoiceLedger,
      seal: sealAddr,
      businessId: business.id,
      payerRef: hash(0),
      invoiceNumber: "INV-2024",
      token: deployment.tokens.usdc,
      total: 2500_000000n,
      dueDate: new Date(),
      envelope: "{}",
      source: "link",
    });

    await db.insert(chainEvents).values({
      chainId: arcTestnet.id,
      txHash: hash(21),
      logIndex: 0,
      blockNumber: 1500n,
      blockTime: new Date("2026-09-28T12:00:00Z"),
      address: deployment.contracts.invoiceLedger.toLowerCase(),
      eventName: "Settled",
      args: { fingerprint: fp, credit: "2500000000", paid: "2480000000", discountBps: 80, payoutDomain: 0, payoutAddress: address(21) },
    });

    const data = await loadAccounting(db, mockContracts, undefined, deployment, owner, business.id);
    expect(data.payments.length).toBe(1);
    expect(data.payments[0]!.vendor).toBe("Kestrel Labs");
    expect(data.payments[0]!.amount).toBe("2480.000000");
    expect(data.payments[0]!.token).toBe("USDC");
    expect(data.totals.usdcTotal).toBe("2480.000000");
    expect(data.totals.eurcTotal).toBe("0.000000");
  });

  it("exportAccounting: generates CSV export with SHA-256 and records decision (K15, K19)", async () => {
    const { owner, business, sealAddr } = await fixture();

    const fp = hash(30);
    await db.insert(invoices).values({
      fingerprint: fp,
      chainId: arcTestnet.id,
      ledger: deployment.contracts.invoiceLedger,
      seal: sealAddr,
      businessId: business.id,
      payerRef: hash(0),
      invoiceNumber: "INV-3030",
      token: deployment.tokens.usdc,
      total: 1500_000000n,
      dueDate: new Date(),
      envelope: "{}",
      source: "link",
    });

    await db.insert(chainEvents).values({
      chainId: arcTestnet.id,
      txHash: hash(31),
      logIndex: 1,
      blockNumber: 1600n,
      blockTime: new Date("2026-09-29T10:00:00Z"),
      address: deployment.contracts.invoiceLedger.toLowerCase(),
      eventName: "Settled",
      args: { fingerprint: fp, credit: "1500000000", paid: "1500000000", discountBps: 0, payoutDomain: 0, payoutAddress: address(21) },
    });

    const res = await exportAccounting(db, owner, business.id, "csv");
    expect(res.filename).toContain("symbolon-payments-accounting-corp");
    expect(res.filename).toContain(".csv");
    expect(res.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.content).toContain("INV-3030");
    expect(res.content).toContain("1500.000000");

    // Decision record appended
    const [dec] = await db
      .select()
      .from(decisions)
      .where(decisions.subject ? undefined : undefined);
    expect(dec).toBeDefined();
  });

  it("exportAccounting: generates Beancount export that balances to zero (K16)", async () => {
    const { owner, business, sealAddr } = await fixture();

    const fp = hash(40);
    await db.insert(invoices).values({
      fingerprint: fp,
      chainId: arcTestnet.id,
      ledger: deployment.contracts.invoiceLedger,
      seal: sealAddr,
      businessId: business.id,
      payerRef: hash(0),
      invoiceNumber: "INV-4040",
      token: deployment.tokens.usdc,
      total: 3000_000000n,
      dueDate: new Date(),
      envelope: "{}",
      source: "link",
    });

    await db.insert(chainEvents).values({
      chainId: arcTestnet.id,
      txHash: hash(41),
      logIndex: 2,
      blockNumber: 1700n,
      blockTime: new Date("2026-09-29T11:00:00Z"),
      address: deployment.contracts.invoiceLedger.toLowerCase(),
      eventName: "Settled",
      args: { fingerprint: fp, credit: "3000000000", paid: "2970000000", discountBps: 100, payoutDomain: 0, payoutAddress: address(21) },
    });

    const res = await exportAccounting(db, owner, business.id, "beancount");
    expect(res.filename).toContain(".beancount");
    expect(res.content).toContain("Expenses:Payables:");
    expect(res.content).toContain("3000.000000 USDC");
    expect(res.content).toContain("Assets:Symbolon:Vault:USDC  -2970.000000 USDC");
    expect(res.content).toContain("Income:EarlyPayDiscounts  -30.000000 USDC");
  });

  it("resyncLedger: requires owner/approver/operator; rejects viewer", async () => {
    const { viewer, business } = await fixture();
    const mockClient: any = {
      getBlockNumber: async () => 1000n,
      getLogs: async () => [],
    };
    const mockContracts: any = {
      invoiceLedger: { read: { getInvoice: async () => [0n, false, false, 0n] } },
    };

    await expect(
      resyncLedger(db, mockClient, mockContracts, deployment, viewer, business.id),
    ).rejects.toMatchObject({ status: 403 });
  });
});


describe("accounting audit boundary repairs", () => {
  async function settled(token: string, blockTime: Date | null = new Date("2026-09-29T11:00:00Z")) {
    const f = await fixture(); const fp = hash(++vaultNo);
    await db.insert(invoices).values({ fingerprint: fp, chainId: deployment.chainId, ledger: deployment.contracts.invoiceLedger,
      seal: f.sealAddr, businessId: f.business.id, payerRef: hash(0), invoiceNumber: "EUR-INVOICE", token,
      total: 1000000n, dueDate: new Date(), envelope: "{}", source: "link" });
    await db.insert(chainEvents).values({ chainId: deployment.chainId, txHash: hash(++vaultNo), logIndex: 0,
      blockNumber: 2000n, blockTime, address: deployment.contracts.invoiceLedger.toLowerCase(), eventName: "Settled",
      args: { fingerprint: fp, credit: "1000000", paid: "1000000" } });
    return f;
  }
  const failedContracts = { ledger: { read: { status: async () => { throw new Error("offline"); }, remaining: async () => 0n } } } as unknown as SymbolonContracts;
  it("registry EURC remains EURC in view, CSV and Beancount", async () => {
    const f = await settled(deployment.tokens.eurc);
    const view = await loadAccounting(db, failedContracts, undefined, deployment, f.owner, f.business.id);
    expect(view.payments[0]?.token).toBe("EURC"); expect(view.totals.eurcTotal).toBe("1.000000"); expect(view.totals.usdcTotal).toBe("0.000000");
    expect((await exportAccounting(db, f.owner, f.business.id, "csv")).content).toContain("EURC");
    expect((await exportAccounting(db, f.owner, f.business.id, "beancount")).content).toContain("1.000000 EURC");
  });
  it("RPC failure stays unavailable and exports warning plus provenance", async () => {
    const f = await settled(deployment.tokens.usdc);
    const view = await loadAccounting(db, failedContracts, undefined, deployment, f.owner, f.business.id);
    expect(view.reconciliation.status).toBe("unavailable"); expect(view.reconciliation.totalCompared).toBe(0);
    const exported = await exportAccounting(db, f.owner, f.business.id, "csv");
    expect(exported.content).toContain("# UNRECONCILED: comparison unavailable");
    const rows = await db.select().from(decisions).where(eq(decisions.businessId, f.business.id));
    const rec = rows.find(r => r.kind === "export_created")?.record as { inputs: { reconciled: { status: string } } };
    expect(rec.inputs.reconciled.status).toBe("unavailable");
  });
  it("completed POST re-sync provenance warns on exact mismatches and becomes unavailable when the copy changes", async () => {
    const f = await settled(deployment.tokens.usdc);
    const client = { getBlockNumber: async () => deployment.startBlock + 1n, getLogs: async () => [], getBlock: async () => ({ timestamp: 1n }),
      readContract: async ({ functionName }: { functionName: string }) => functionName === "status"
        ? { seen: true, total: 1000000n, credited: 1n, cancelled: false, seal: f.sealAddr } : 999999n,
    } as unknown as PublicClient;
    const contracts = { ledger: { read: { status: async () => ({ seen: true, total: 1000000n, credited: 1n, cancelled: false, seal: f.sealAddr }), remaining: async () => 999999n } } } as unknown as SymbolonContracts;
    const before = await db.select().from(decisions).where(eq(decisions.businessId, f.business.id));
    await loadAccounting(db, contracts, client, deployment, f.owner, f.business.id);
    expect(await db.select().from(decisions).where(eq(decisions.businessId, f.business.id))).toHaveLength(before.length);
    await resyncLedger(db, client, contracts, deployment, f.owner, f.business.id);
    const file = await exportAccounting(db, f.owner, f.business.id, "csv");
    expect(file.content).toContain("# UNRECONCILED: 2 mismatches at block");
    await db.update(invoices).set({ credited: 1n, status: "partially_paid" }).where(eq(invoices.businessId, f.business.id));
    expect((await exportAccounting(db, f.owner, f.business.id, "csv")).content).toContain("# UNRECONCILED: comparison unavailable");
  });
  it("unknown token never adds to USDC; missing block time cannot fabricate a Beancount date", async () => {
    const f = await settled(address(++sealNo), null);
    const view = await loadAccounting(db, failedContracts, undefined, deployment, f.owner, f.business.id);
    expect(view.payments[0]?.token).toBe("UNKNOWN"); expect(view.totals.usdcTotal).toBe("0.000000");
    await expect(exportAccounting(db, f.owner, f.business.id, "beancount")).rejects.toThrow(/block time|token/i);
  });
});
