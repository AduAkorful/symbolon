import { beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment, invoiceLedgerAbi } from "@symbolon/chain";
import { businesses, createTestDb, invoices, type Database } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice } from "@symbolon/seal";
import type { Hex, PublicClient } from "viem";

vi.mock("server-only", () => ({}));

import { loadReceipt } from "@/lib/server/receipt";

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

  it("loads receipt and parses Settled logs from chain", async () => {
    const vault = randAddr();
    const { sealed, envelope, fingerprint } = await createInvoiceEnvelope(vault, "INV-RCPT-1");

    const [biz] = await db
      .insert(businesses)
      .values({
        name: "Acme Receipt Payer",
        chainId: cfg.chainId,
        vault,
        vaultBlock: 1000n,
        stewardWallet: randAddr(),
      })
      .returning();

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
      invoiceNumber: "INV-RCPT-1",
      envelope,
      total: 2500_000_000n,
      credited: 2500_000_000n,
      receivedAt: new Date(),
      status: "paid",
    });

    const mockLogs = [
      {
        eventName: "Settled",
        args: {
          fingerprint: fingerprint as `0x${string}`,
          seal: sealed.document.seal as `0x${string}`,
          payer: vault as `0x${string}`,
          token: cfg.deployment.tokens.usdc as `0x${string}`,
          credit: 2500_000_000n,
          paid: 2470_000_000n,
          discountBps: 120, // 1.2%
          payoutDomain: 26,
          payoutAddress: randAddr() as `0x${string}`,
        },
        transactionHash: "0xabcdef123456" as `0x${string}`,
        blockNumber: 64060470n,
      },
    ];

    const client = {
      readContract: vi.fn().mockImplementation(async ({ functionName }) => functionName === "remaining" ? 0n : { seen: true, cancelled: false, total: 2500_000_000n, credited: 2500_000_000n }),
      getBlockNumber: vi.fn().mockResolvedValue(64060500n),
      getLogs: vi.fn().mockResolvedValue(mockLogs),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_790_100_000n }),
    } as unknown as PublicClient;

    const receipt = await loadReceipt(db, client, cfg, fingerprint);

    expect(receipt).not.toBeNull();
    expect(receipt?.state).toBe("settled");
    if (receipt && receipt.state === "settled") {
      expect(receipt.invoiceNumber).toBe("INV-RCPT-1");
      expect(receipt.vendor.name).toBe("Design Studio");
      expect(receipt.settlements).toHaveLength(1);
      expect(receipt.settlements[0]!.txHash).toBe("0xabcdef123456");
      expect(receipt.settlements[0]!.discountBps).toBe(120);
      expect(receipt.totalPaidFormatted).toBe("2470.000000");
      expect(receipt.totalCreditFormatted).toBe("2500.000000");
    }
  });
});
