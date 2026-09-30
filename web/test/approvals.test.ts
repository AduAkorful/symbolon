import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment, symbolonVaultAbi, type Deployment } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  decisions,
  invoices,
  members,
  seals,
  users,
  type Database,
} from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealDomain, sealInvoice } from "@symbolon/seal";

vi.mock("server-only", () => ({}));

const chainState = vi.hoisted(() => ({
  isApprover: vi.fn(),
  getPolicy: vi.fn(),
  getVaultState: vi.fn(),
  readContract: vi.fn(),
  call: vi.fn(),
  getTransactionReceipt: vi.fn(),
}));

vi.mock("@symbolon/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@symbolon/chain")>();
  return {
    ...actual,
    symbolonContracts: () => ({
      lens: {
        read: {
          isApprover: chainState.isApprover,
          getPolicy: chainState.getPolicy,
          getVaultState: chainState.getVaultState,
        },
      },
      ledger: {
        read: {
          remaining: vi.fn().mockResolvedValue(100_000_000n),
          invoiceStatus: vi.fn().mockResolvedValue({ paid: 0n, remaining: 100_000_000n, status: 1 }),
        },
      },
    }),
  };
});

import {
  listApprovals,
  prepareApproval,
  preparePayNow,
  recordPayNow,
  rejectApproval,
  releaseHold,
  submitApproval,
} from "@/lib/server/approvals";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(() => {
  chainState.isApprover.mockReset().mockResolvedValue(true);
  chainState.getPolicy.mockReset().mockResolvedValue({
    autoPayLimit: 50_000_000n,
    ownerThreshold: 500_000_000n,
    screeningMaxAge: 0n,
    paused: false,
  });
  chainState.call.mockReset().mockResolvedValue({ data: "0x" });
  chainState.getTransactionReceipt.mockReset();
});

const cfg = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
};

const sealKey = privateKeyToAccount(generatePrivateKey());
const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const randHash = () => ("0x" + "a".repeat(64)) as Hex;

async function createInvoiceEnvelope(vault: string, number: string, totalAmount = "100") {
  const document = completeTotals({
    schema: "symbolon.invoice.v1",
    seal: sealKey.address.toLowerCase(),
    vendor: { name: "Acme Supplies" },
    payer: { name: "Payer Corp", vault },
    invoiceNumber: number,
    issuedAt: 1_790_000_000,
    dueDate: 1_792_592_000,
    currency: {
      chainId: cfg.chainId,
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      symbol: "USDC",
      decimals: 6,
    },
    lineItems: [{ description: "Consulting", quantity: "1", unitPrice: totalAmount }],
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

async function setupBusinessWithUser(role: "owner" | "approver" | "viewer" = "owner", mode: "shadow" | "assist" | "auto" = "auto") {
  const userKey = privateKeyToAccount(generatePrivateKey());
  const [u] = await db
    .insert(users)
    .values({ wallet: userKey.address.toLowerCase() })
    .returning();
  const vault = randAddr();
  const [b] = await db
    .insert(businesses)
    .values({
      name: "Acme Approvals Test",
      chainId: cfg.chainId,
      vault,
      vaultBlock: 1000n,
      stewardWallet: randAddr(),
      stewardMode: mode,
    })
    .returning();
  await db.insert(members).values({ businessId: b!.id, userId: u!.id, role });
  chainState.getVaultState.mockResolvedValue({
    paused: false,
    steward: randAddr(),
    owner: userKey.address.toLowerCase(),
  });
  return { user: u!, userKey, business: b!, vault };
}

describe("Approvals Service", () => {
  it("lists invoices awaiting approval and checks user permissions", async () => {
    const { user, business, vault } = await setupBusinessWithUser("owner", "auto");
    const { sealed, envelope, fingerprint } = await createInvoiceEnvelope(vault, "INV-001", "200");

    await db.insert(invoices).values({
      businessId: business.id,
      fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: "INV-001",
      envelope,
      total: 200_000_000n,
      credited: 0n,
      receivedAt: new Date(),
      status: "awaiting_approval",
    });

    // Insert a decision for this invoice
    await db.insert(decisions).values({
      businessId: business.id,
      subject: fingerprint,
      hash: "0x1111",
      kind: "steward_run",
      record: {
        kind: "steward_run",
        trigger: "schedule",
        timestamp: Math.floor(Date.now() / 1000),
        mode: "auto",
        inputs: {},
        options: [],
        rule: "invoice exceeds auto-pay limit",
        outcome: "request_approval",
      },
      createdAt: new Date(),
    });

    const client = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_790_000_100n }),
    } as unknown as PublicClient;

    const res = await listApprovals(db, client, cfg, user, business.id);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.fingerprint).toBe(fingerprint);
    expect(res.items[0]!.canSign).toBe(true);
    expect(res.items[0]!.canPayNow).toBe(true);
  });

  it("prepareApproval constructs EIP-712 typed data when in auto mode", async () => {
    const { user, business, vault } = await setupBusinessWithUser("owner", "auto");
    const { sealed, envelope, fingerprint } = await createInvoiceEnvelope(vault, "INV-002", "300");

    await db.insert(invoices).values({
      businessId: business.id,
      fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: "INV-002",
      envelope,
      total: 300_000_000n,
      credited: 0n,
      receivedAt: new Date(),
      status: "awaiting_approval",
    });

    const client = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_790_000_200n }),
    } as unknown as PublicClient;

    const prep = await prepareApproval(db, client, cfg, user, business.id, fingerprint);
    expect(prep.typedData).toBeDefined();
    expect(prep.typedData.primaryType).toBe("Approval");
    expect(prep.typedData.message.fingerprint).toBe(fingerprint);
    expect(BigInt(prep.deadline)).toBeGreaterThan(1_790_000_200n);
  });

  it("prepareApproval fails if business is not in auto mode", async () => {
    const { user, business, vault } = await setupBusinessWithUser("owner", "assist");
    const { sealed, envelope, fingerprint } = await createInvoiceEnvelope(vault, "INV-003", "300");

    await db.insert(invoices).values({
      businessId: business.id,
      fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: "INV-003",
      envelope,
      total: 300_000_000n,
      credited: 0n,
      receivedAt: new Date(),
      status: "awaiting_approval",
    });

    const client = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_790_000_200n }),
    } as unknown as PublicClient;

    await expect(
      prepareApproval(db, client, cfg, user, business.id, fingerprint)
    ).rejects.toThrow(/autonomous mode/i);
  });

  it("submits approval with valid signature and records decision", async () => {
    const { user, userKey, business, vault } = await setupBusinessWithUser("owner", "auto");
    const { sealed, envelope, fingerprint } = await createInvoiceEnvelope(vault, "INV-004", "400");

    await db.insert(invoices).values({
      businessId: business.id,
      fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: "INV-004",
      envelope,
      total: 400_000_000n,
      credited: 0n,
      receivedAt: new Date(),
      status: "awaiting_approval",
    });

    const client = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_790_000_300n }),
    } as unknown as PublicClient;

    const prep = await prepareApproval(db, client, cfg, user, business.id, fingerprint);

    // Sign the typed data using userKey
    const signature = await userKey.signTypedData({
      domain: prep.typedData.domain,
      types: prep.typedData.types,
      primaryType: "Approval",
      message: prep.typedData.message,
    } as any);

    const sub = await submitApproval(db, client, cfg, user, business.id, {
      fingerprint,
      deadline: prep.deadline,
      signature,
    });

    expect(sub.ok).toBe(true);
    expect(sub.signer.toLowerCase()).toBe(userKey.address.toLowerCase());
  });

  it("rejectApproval requires reason and marks invoice held by human", async () => {
    const { user, business, vault } = await setupBusinessWithUser("owner", "auto");
    const { sealed, envelope, fingerprint } = await createInvoiceEnvelope(vault, "INV-005", "500");

    await db.insert(invoices).values({
      businessId: business.id,
      fingerprint,
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
      seal: sealed.document.seal,
      payerRef: randHash(),
      source: "link",
      dueDate: new Date(1_792_592_000 * 1000),
      token: cfg.deployment.tokens.usdc.toLowerCase(),
      invoiceNumber: "INV-005",
      envelope,
      total: 500_000_000n,
      credited: 0n,
      receivedAt: new Date(),
      status: "awaiting_approval",
    });

    const client = {} as PublicClient;

    // Reason too short
    await expect(
      rejectApproval(db, client, cfg, user, business.id, {
        fingerprint,
        reason: "no",
      })
    ).rejects.toThrow(/at least 3 characters/i);

    // Successful rejection
    const res = await rejectApproval(db, client, cfg, user, business.id, {
      fingerprint,
      reason: "Vendor pricing does not match PO agreed terms",
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("held");
    expect(res.holdSource).toBe("human");

    // Check releaseHold by owner
    const released = await releaseHold(db, client, cfg, user, business.id, fingerprint);
    expect(released.ok).toBe(true);
    expect(released.status).toBe("verified");
    expect(released.holdSource).toBeNull();
  });
});
