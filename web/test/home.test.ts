import { beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  businesses,
  chainEvents,
  createTestDb,
  decisions,
  invoices,
  members,
  payees,
  unsignedBills,
  users,
} from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice } from "@symbolon/seal";
import type { Hex, PublicClient } from "viem";

vi.mock("server-only", () => ({}));

import { loadNeedsYou, loadToday, loadAhead } from "@/lib/server/home";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
  stewardCircle: { apiKey: "key", entitySecret: "secret" },
};

const sealKey = privateKeyToAccount(generatePrivateKey());
const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const randHash = () => ("0x" + "c".repeat(64)) as Hex;

async function createInvoiceEnvelope(vault: string, number: string, total = "500") {
  const document = completeTotals({
    schema: "symbolon.invoice.v1",
    seal: sealKey.address.toLowerCase(),
    vendor: { name: "Supplier Corp" },
    payer: { name: "Test Corp", vault },
    invoiceNumber: number,
    issuedAt: 1_790_000_000,
    dueDate: 1_792_592_000,
    currency: {
      chainId: cfg.chainId,
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      symbol: "USDC",
      decimals: 6,
    },
    lineItems: [{ description: "Parts", quantity: "1", unitPrice: total }],
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

async function setupBusiness() {
  const [u] = await db.insert(users).values({ wallet: randAddr() }).returning();
  const vault = randAddr();
  const stewardWallet = randAddr();
  const [b] = await db
    .insert(businesses)
    .values({
      name: "Home Queues Test Biz",
      chainId: cfg.chainId,
      vault,
      vaultBlock: 1000n,
      stewardWallet,
      stewardMode: "assist",
    })
    .returning();
  await db.insert(members).values({ businessId: b!.id, userId: u!.id, role: "owner" });
  return { user: u!, business: b!, vault, stewardWallet };
}

describe("Home Queues Service", () => {
  it("loadNeedsYou aggregates pending items from multiple sources", async () => {
    const { user, business, vault } = await setupBusiness();

    // 1. Awaiting approval invoice
    const inv1 = await createInvoiceEnvelope(vault, "INV-NEED-1", "1200");
    await db.insert(invoices).values({
      businessId: business.id,
      fingerprint: inv1.fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: inv1.sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: "INV-NEED-1",
      envelope: inv1.envelope,
      total: 1200_000_000n,
      credited: 0n,
      receivedAt: new Date(),
      status: "awaiting_approval",
    });

    // 2. Steward held invoice
    const inv2 = await createInvoiceEnvelope(vault, "INV-NEED-2", "800");
    await db.insert(invoices).values({
      businessId: business.id,
      fingerprint: inv2.fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: inv2.sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: "INV-NEED-2",
      envelope: inv2.envelope,
      total: 800_000_000n,
      credited: 0n,
      receivedAt: new Date(),
      status: "held",
      holdSource: "steward",
    });

    // 3. Human held invoice
    const inv3 = await createInvoiceEnvelope(vault, "INV-NEED-3", "450");
    await db.insert(invoices).values({
      businessId: business.id,
      fingerprint: inv3.fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: inv3.sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: "INV-NEED-3",
      envelope: inv3.envelope,
      total: 450_000_000n,
      credited: 0n,
      receivedAt: new Date(),
      status: "held",
      holdSource: "human",
    });

    // 4. Unsigned bill
    await db.insert(unsignedBills).values({
      businessId: business.id,
      uploadedBy: user.id,
      fileName: "test.pdf",
      fileSha256: randHash(),
      extraction: {},
      assessment: {},
      status: "open",
      createdAt: new Date(),
    });

    // 5. Payee awaiting second verification
    await db.insert(payees).values({
      businessId: business.id,
      seal: randAddr(),
      status: "pending_verification",
    });

    const client = {
      getBalance: vi.fn().mockResolvedValue(50_000_000_000_000_000n), // 0.05 USDC fee balance
      readContract: vi.fn().mockResolvedValue(false), // paused = false
    } as unknown as PublicClient;

    const needsYou = await loadNeedsYou(db, client, cfg, user, business.id);

    expect(needsYou.awaitingApproval.count).toBe(1);
    expect(needsYou.awaitingApproval.top[0]!.invoiceNumber).toBe("INV-NEED-1");
    expect(needsYou.stewardHeld.count).toBe(1);
    expect(needsYou.humanHeld.count).toBe(1);
    expect(needsYou.unsignedBillsCount).toBe(1);
    expect(needsYou.pendingVerificationsCount).toBe(1);
  });

  it("loadToday aggregates today's activity", async () => {
    const { user, business } = await setupBusiness();

    // Decisions recorded today
    await db.insert(decisions).values({
      businessId: business.id,
      hash: "0xdec1",
      kind: "steward_run",
      record: {
        kind: "steward_run",
        trigger: "schedule",
        timestamp: Math.floor(Date.now() / 1000),
        mode: "assist",
        inputs: {},
        options: [],
        rule: "test",
        outcome: "request_approval",
      } as never,
      createdAt: new Date(),
    });

    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(20000n),
    } as unknown as PublicClient;

    const today = await loadToday(db, client, cfg, user, business.id);

    expect(today.decisionsCount).toBeGreaterThanOrEqual(1);
    expect(today.asOfBlock).toBe("20000");
    expect(today.asOfTime).toBeInstanceOf(Date);
  });
  it("Ahead coverage uses the selected buffer and refuses a cash claim on failed balances", async () => {
    const { user, business } = await setupBusiness();
    const client = { readContract: vi.fn().mockResolvedValue(0n) } as unknown as PublicClient;
    expect((await loadAhead(db, client, cfg, user, business.id)).runwayStatement).toContain("30-day buffer");
    vi.mocked(client.readContract).mockRejectedValue(new Error("offline"));
    const result = await loadAhead(db, client, cfg, user, business.id);
    expect(result.runwayStatement).toContain("unavailable");
    expect(result.shortfalls).toEqual([]);
  });

});
