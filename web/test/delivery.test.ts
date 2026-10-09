import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import { createTestDb, businesses, decisions, deliveries, invoices, members, notifications, seals, users } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice } from "@symbolon/seal";
import { eq } from "drizzle-orm";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  stringToBytes,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { chainDouble, chainState } from "./setup-shared";

import { prepareDelivery, recordDelivery } from "@/lib/server/delivery";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(() => {
  chainDouble.enabled = true;
  chainState.isRequester.mockReset();
  chainState.deliveryConfirmed.mockReset();
  chainState.invoiceStatus.mockReset();
});

const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
const sealKey = privateKeyToAccount(generatePrivateKey());
const randAddr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

async function envelopeTo(vault: string, number: string) {
  const document = completeTotals({
    schema: "symbolon.invoice.v1",
    seal: sealKey.address.toLowerCase(),
    vendor: { name: "Studio Ana" },
    payer: { name: "Acme", vault },
    invoiceNumber: number,
    issuedAt: 1_790_000_000,
    dueDate: 1_792_592_000,
    currency: { chainId: cfg.chainId, token: cfg.deployment.tokens.usdc.toLowerCase(), symbol: "USDC", decimals: 6 },
    lineItems: [{ description: "Work", quantity: "1", unitPrice: "100" }],
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
  return { envelope: encodeSealedInvoice(sealed), fingerprint };
}

async function fixture(role: "owner" | "requester" | "viewer" = "owner") {
  const ownerWallet = randAddr();
  const [user] = await db.insert(users).values({ wallet: ownerWallet }).returning();
  const [vendorUser] = await db.insert(users).values({ email: "v-" + crypto.randomUUID() + "@vendor.test" }).returning();

  const vault = randAddr();
  const [business] = await db.insert(businesses).values({ name: "Acme", chainId: cfg.chainId, vault }).returning();
  await db.insert(members).values({ businessId: business!.id, userId: user!.id, role });

  await db.insert(seals).values({
    address: sealKey.address.toLowerCase(),
    userId: vendorUser!.id,
    handle: "studio-" + crypto.randomUUID().slice(0, 6),
    displayName: "Studio Ana",
  }).onConflictDoNothing();

  const { envelope, fingerprint } = await envelopeTo(vault, "INV-" + crypto.randomUUID().slice(0, 6));
  const payerRef = `0x${"00".repeat(12)}${vault.slice(2).toLowerCase()}` as Hex;

  await db.insert(invoices).values({
    fingerprint,
    chainId: cfg.chainId,
    ledger: cfg.deployment.contracts.invoiceLedger.toLowerCase(),
    seal: sealKey.address.toLowerCase(),
    businessId: business!.id,
    payerRef,
    invoiceNumber: "INV-1",
    token: cfg.deployment.tokens.usdc.toLowerCase(),
    total: 100_000000n,
    dueDate: new Date(1_792_592_000 * 1000),
    issuedAt: new Date(1_790_000_000 * 1000),
    envelope,
    source: "upload",
    status: "verified",
  });

  return { user: user!, business: business!, fingerprint, vault, ownerWallet };
}

function confirmedLog(vault: string, fingerprint: Hex, by: string) {
  return {
    address: getAddress(vault),
    topics: encodeEventTopics({
      abi: symbolonVaultAbi,
      eventName: "DeliveryConfirmed",
      args: { fingerprint, by: getAddress(by) },
    }),
    data: "0x" as Hex,
  };
}

function rejectedLog(vault: string, fingerprint: Hex, by: string, reasonHash: Hex) {
  return {
    address: getAddress(vault),
    topics: encodeEventTopics({
      abi: symbolonVaultAbi,
      eventName: "DeliveryRejected",
      args: { fingerprint, by: getAddress(by) },
    }),
    data: encodeAbiParameters([{ type: "bytes32" }], [reasonHash]),
  };
}

function mockClient(vaultOwner: string, overrides: Record<string, unknown> = {}) {
  return {
    readContract: async () => vaultOwner,
    ...overrides,
  } as unknown as PublicClient;
}

describe("prepareDelivery", () => {
  it("rejects unauthorized role (viewer) with 403", async () => {
    const { user, business, fingerprint } = await fixture("viewer");
    const client = mockClient(user.wallet!);
    await expect(
      prepareDelivery(db, client, cfg, user, business.id, {
        action: "confirm",
        fingerprint,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects if wallet is neither owner nor onchain requester (N8)", async () => {
    const { user, business, fingerprint } = await fixture("owner");
    const anotherOwner = randAddr();
    const client = mockClient(anotherOwner); // vault owner is someone else
    chainState.isRequester.mockResolvedValue(false); // not requester either
    chainState.invoiceStatus.mockResolvedValue({ paid: false, cancelled: false });

    await expect(
      prepareDelivery(db, client, cfg, user, business.id, {
        action: "confirm",
        fingerprint,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("prepares confirm call for the owner", async () => {
    const { user, business, fingerprint, vault, ownerWallet } = await fixture("owner");
    const client = mockClient(ownerWallet);
    chainState.isRequester.mockResolvedValue(false);
    chainState.invoiceStatus.mockResolvedValue({ paid: false, cancelled: false });

    const prep = await prepareDelivery(db, client, cfg, user, business.id, {
      action: "confirm",
      fingerprint,
    });
    expect(prep.action).toBe("confirm");
    expect(prep.fingerprint).toBe(fingerprint);
    expect(prep.to).toBe(getAddress(vault));
  });

  it("prepares reject call with reasonHash and trimmed reason", async () => {
    const { user, business, fingerprint, vault, ownerWallet } = await fixture("owner");
    const client = mockClient(ownerWallet);
    chainState.isRequester.mockResolvedValue(false);
    chainState.invoiceStatus.mockResolvedValue({ paid: false, cancelled: false });

    const prep = await prepareDelivery(db, client, cfg, user, business.id, {
      action: "reject",
      fingerprint,
      reason: "   Items arrived damaged in transit.   ",
    });
    expect(prep.action).toBe("reject");
    expect(prep.reason).toBe("Items arrived damaged in transit.");
    expect(prep.reasonHash).toBe(keccak256(stringToBytes("Items arrived damaged in transit.")));
  });

  it("rejects empty or too short rejection reason", async () => {
    const { user, business, fingerprint, ownerWallet } = await fixture("owner");
    const client = mockClient(ownerWallet);
    chainState.isRequester.mockResolvedValue(false);
    chainState.invoiceStatus.mockResolvedValue({ paid: false, cancelled: false });

    await expect(
      prepareDelivery(db, client, cfg, user, business.id, {
        action: "reject",
        fingerprint,
        reason: "  ",
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      prepareDelivery(db, client, cfg, user, business.id, {
        action: "reject",
        fingerprint,
        reason: "no",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("recordDelivery", () => {
  it("records confirm delivery from receipt, releases human hold, and logs decision", async () => {
    const { user, business, fingerprint, vault, ownerWallet } = await fixture("owner");
    const txHash = `0x${"11".repeat(32)}` as Hex;

    // Put invoice in held state with human source first
    await db
      .update(invoices)
      .set({ status: "held", holdSource: "human", holdKind: "delivery" })
      .where(eq(invoices.fingerprint, fingerprint.toLowerCase()));

    chainState.deliveryConfirmed.mockResolvedValue(true);

    const client = mockClient(ownerWallet, {
      getTransactionReceipt: async () => ({
        status: "success",
        to: getAddress(vault),
        logs: [confirmedLog(vault, fingerprint as Hex, ownerWallet)],
      }),
    });

    const recorded = await recordDelivery(db, client, cfg, user, business.id, {
      action: "confirm",
      fingerprint,
      txHash,
    });
    expect(recorded.action).toBe("confirm");

    // Delivery row created
    const [delRow] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.fingerprint, fingerprint.toLowerCase()));
    expect(delRow).toBeDefined();
    expect(delRow!.state).toBe("confirmed");

    // Human hold released back to verified
    const [invRow] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.fingerprint, fingerprint.toLowerCase()));
    expect(invRow!.status).toBe("verified");
    expect(invRow!.holdSource).toBeNull();

    // Decision logged
    const [dec] = await db
      .select()
      .from(decisions)
      .where(eq(decisions.kind, "delivery_confirmed"));
    expect(dec).toBeDefined();
    expect(dec!.subject).toBe(fingerprint.toLowerCase());
  });

  it("records reject delivery: holds invoice, creates vendor notification, and logs decision", async () => {
    const { user, business, fingerprint, vault, ownerWallet } = await fixture("owner");
    const txHash = `0x${"22".repeat(32)}` as Hex;
    const reason = "Wrong specifications delivered.";
    const reasonHash = keccak256(stringToBytes(reason));

    const client = mockClient(ownerWallet, {
      getTransactionReceipt: async () => ({
        status: "success",
        to: getAddress(vault),
        logs: [rejectedLog(vault, fingerprint as Hex, ownerWallet, reasonHash)],
      }),
    });

    const recorded = await recordDelivery(db, client, cfg, user, business.id, {
      action: "reject",
      fingerprint,
      txHash,
      reason,
    });
    expect(recorded.action).toBe("reject");

    // Deliveries row created
    const [delRow] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.fingerprint, fingerprint.toLowerCase()));
    expect(delRow!.state).toBe("rejected");
    expect(delRow!.reason).toBe(reason);

    // Invoice held with human source
    const [invRow] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.fingerprint, fingerprint.toLowerCase()));
    expect(invRow!.status).toBe("held");
    expect(invRow!.holdSource).toBe("human");

    // Vendor notification created
    const notifs = await db.select().from(notifications);
    expect(notifs.some((n) => n.kind === "delivery_rejected" && n.subject === fingerprint.toLowerCase())).toBe(true);

    // Decision logged
    const [dec] = await db
      .select()
      .from(decisions)
      .where(eq(decisions.kind, "delivery_rejected"));
    expect(dec).toBeDefined();
    expect(dec!.subject).toBe(fingerprint.toLowerCase());
  });
});
