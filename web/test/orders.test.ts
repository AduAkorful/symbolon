import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import { createTestDb, businesses, decisions, invoices, members, payees, purchaseOrders, seals, users } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, poRef as computePoRef, sealInvoice } from "@symbolon/seal";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex, type PublicClient } from "viem";

import { chainDouble, chainState } from "./setup-shared";

import { adoptUnrecordedPo, listOrders, prepareOpenPo, recordOpenPo, prepareClosePo, recordClosePo } from "@/lib/server/orders";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(() => {
  chainDouble.enabled = true;
  chainState.getPurchaseOrder.mockReset();
  chainState.getVaultState.mockReset();
});

const address = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const deployment = getDeployment(arcTestnet.id);
let vaultNo = 50;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({ email: "po-owner-" + crypto.randomUUID() + "@example.test" })
    .returning();
  const [member] = await db
    .insert(users)
    .values({ email: "po-member-" + crypto.randomUUID() + "@example.test" })
    .returning();
  const [vendor] = await db
    .insert(users)
    .values({ email: "po-vendor-" + crypto.randomUUID() + "@example.test" })
    .returning();

  const [business] = await db
    .insert(businesses)
    .values({ name: "Northwind", chainId: arcTestnet.id, vault: address(++vaultNo) })
    .returning();

  await db.insert(members).values({ businessId: business!.id, userId: owner!.id, role: "owner" });
  await db.insert(members).values({ businessId: business!.id, userId: member!.id, role: "viewer" });

  const vendorSeal = address(100 + vaultNo);
  await db.insert(seals).values({
    address: vendorSeal,
    userId: vendor!.id,
    handle: "vendor-" + crypto.randomUUID().slice(0, 8),
    displayName: "Acme Supplies",
  });

  await db.insert(payees).values({
    businessId: business!.id,
    seal: vendorSeal.toLowerCase(),
    status: "verified",
    verificationMethod: "invitation",
    verifiedBy: owner!.id,
    verifiedAt: new Date(),
  });

  return { owner: owner!, member: member!, business: business!, vendorSeal };
}

function openPoLog(vault: string, poRef: Hex, seal: string, budget: Hex, amount: bigint, releaseAfter: bigint) {
  return {
    address: getAddress(vault),
    topics: encodeEventTopics({
      abi: symbolonVaultAbi,
      eventName: "PurchaseOrderOpened",
      args: { poRef, seal: getAddress(seal) },
    }),
    data: encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [budget, amount, releaseAfter],
    ),
  };
}

function closePoLog(vault: string, poRef: Hex) {
  return {
    address: getAddress(vault),
    topics: encodeEventTopics({
      abi: symbolonVaultAbi,
      eventName: "PurchaseOrderClosed",
      args: { poRef },
    }),
    data: "0x" as Hex,
  };
}

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    readContract: async () => "0x" + "00".repeat(32),
    getTransactionReceipt: async () => ({ status: "success" }),
    ...overrides,
  } as unknown as PublicClient;
}

describe("prepareOpenPo", () => {
  it("rejects non-owner with 403", async () => {
    const { member, business, vendorSeal } = await fixture();
    const client = mockClient();
    await expect(
      prepareOpenPo(db, client, deployment, member, business.id, {
        poNumber: "PO-100",
        seal: vendorSeal,
        amount: "500.00",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects invalid PO number (empty, too long, or unsafe characters)", async () => {
    const { owner, business, vendorSeal } = await fixture();
    const client = mockClient();
    await expect(
      prepareOpenPo(db, client, deployment, owner, business.id, {
        poNumber: "   ",
        seal: vendorSeal,
        amount: "500.00",
      }),
    ).rejects.toThrow("PO number must be 1–64 characters.");

    await expect(
      prepareOpenPo(db, client, deployment, owner, business.id, {
        poNumber: "A".repeat(65),
        seal: vendorSeal,
        amount: "500.00",
      }),
    ).rejects.toThrow("PO number must be 1–64 characters.");

    await expect(
      prepareOpenPo(db, client, deployment, owner, business.id, {
        poNumber: "PO-100\u202Ereversed",
        seal: vendorSeal,
        amount: "500.00",
      }),
    ).rejects.toThrow("PO number contains unsafe characters.");
  });

  it("refuses duplicate PO number if already existing in DB or lens (N4)", async () => {
    const { owner, business, vendorSeal } = await fixture();
    const poNum = "PO-EXISTING";
    const ref = computePoRef(poNum);

    // Insert row in DB
    await db.insert(purchaseOrders).values({
      businessId: business.id,
      poRef: ref,
      poNumber: poNum,
      seal: vendorSeal.toLowerCase(),
      budget: "0x" + "00".repeat(32),
      amount: 1000_000000n,
      kind: "one_off",
      createdBy: owner.id,
    });

    chainState.getVaultState.mockResolvedValue({ accountingDecimals: 6 });
    chainState.getPurchaseOrder.mockResolvedValue({
      seal: "0x0000000000000000000000000000000000000000",
      open: false,
      remaining: 0n,
      releaseAfter: 0n,
    });

    const client = mockClient();
    await expect(
      prepareOpenPo(db, client, deployment, owner, business.id, {
        poNumber: poNum,
        seal: vendorSeal,
        amount: "500.00",
      }),
    ).rejects.toMatchObject({ status: 409 });

    // Also refuses if lens shows it existing
    chainState.getPurchaseOrder.mockResolvedValue({
      seal: vendorSeal,
      open: true,
      remaining: 1000_000000n,
      releaseAfter: 0n,
    });
    await expect(
      prepareOpenPo(db, client, deployment, owner, business.id, {
        poNumber: "PO-OTHER",
        seal: vendorSeal,
        amount: "500.00",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("successfully prepares open call with encoded calldata", async () => {
    const { owner, business, vendorSeal } = await fixture();
    chainState.getVaultState.mockResolvedValue({ accountingDecimals: 6 });
    chainState.getPurchaseOrder.mockResolvedValue({
      seal: "0x0000000000000000000000000000000000000000",
      open: false,
      remaining: 0n,
      releaseAfter: 0n,
    });

    const client = mockClient();
    const prepared = await prepareOpenPo(db, client, deployment, owner, business.id, {
      poNumber: "PO-2026-001",
      seal: vendorSeal,
      amount: "1500.50",
      description: "Q1 web dev retainer",
      releaseDate: "2026-10-01",
    });

    expect(prepared.poNumber).toBe("PO-2026-001");
    expect(prepared.poRef).toBe(computePoRef("PO-2026-001"));
    expect(prepared.to).toBe(getAddress(business.vault!));
    expect(prepared.data.startsWith("0x")).toBe(true);
    expect(prepared.summary.amount).toBe("1500.500000");
  });
});

describe("recordOpenPo", () => {
  it("records purchase order upon verified receipt and appends decision", async () => {
    const { owner, business, vendorSeal } = await fixture();
    const poNum = "PO-2026-002";
    const ref = computePoRef(poNum);
    const txHash = hash(10);
    const amount = 2000_000000n;

    const receipt = {
      status: "success",
      to: getAddress(business.vault!),
      logs: [openPoLog(business.vault!, ref, vendorSeal, hash(0), amount, 0n)],
    };

    chainState.getPurchaseOrder.mockResolvedValue({
      open: true,
      seal: vendorSeal,
      remaining: amount,
      releaseAfter: 0n,
    });

    const client = mockClient({
      getTransactionReceipt: async () => receipt,
    });

    const recorded = await recordOpenPo(
      db,
      client,
      deployment,
      owner,
      business.id,
      txHash,
      poNum,
      "Valid order",
    );
    expect(recorded.poRef).toBe(ref);

    // Verify row created in DB
    const [row] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.poRef, ref));
    expect(row).toBeDefined();
    expect(row!.poNumber).toBe(poNum);
    expect(row!.amount).toBe(amount);

    // Verify decision created
    const [dec] = await db
      .select()
      .from(decisions)
      .where(eq(decisions.kind, "po_opened"));
    expect(dec).toBeDefined();
    expect(dec!.subject).toBe(ref);

    // Idempotent retry returns successfully without double-insert
    const retry = await recordOpenPo(
      db,
      client,
      deployment,
      owner,
      business.id,
      txHash,
      poNum,
      "Valid order",
    );
    expect(retry.poRef).toBe(ref);
  });

  it("refuses if poNumber does not match onchain poRef", async () => {
    const { owner, business, vendorSeal } = await fixture();
    const txHash = hash(11);
    const ref = computePoRef("PO-ACTUAL");

    const receipt = {
      status: "success",
      to: getAddress(business.vault!),
      logs: [openPoLog(business.vault!, ref, vendorSeal, hash(0), 1000n, 0n)],
    };

    const client = mockClient({
      getTransactionReceipt: async () => receipt,
    });

    await expect(
      recordOpenPo(db, client, deployment, owner, business.id, txHash, "PO-WRONG", null),
    ).rejects.toThrow("The PO number doesn't match the order in that receipt.");
  });
});

describe("prepareClosePo & recordClosePo", () => {
  it("prepares and records PO closure", async () => {
    const { owner, business, vendorSeal } = await fixture();
    const poNum = "PO-TO-CLOSE";
    const ref = computePoRef(poNum);

    await db.insert(purchaseOrders).values({
      businessId: business.id,
      poRef: ref,
      poNumber: poNum,
      seal: vendorSeal.toLowerCase(),
      budget: "0x" + "00".repeat(32),
      amount: 500_000000n,
      kind: "one_off",
      createdBy: owner.id,
    });

    chainState.getPurchaseOrder.mockResolvedValue({
      open: true,
      seal: vendorSeal,
      remaining: 500_000000n,
      releaseAfter: 0n,
    });

    const client = mockClient();
    const prep = await prepareClosePo(db, client, deployment, owner, business.id, ref);
    expect(prep.poRef).toBe(ref);

    // Record close
    const closeTx = hash(20);
    const receipt = {
      status: "success",
      to: getAddress(business.vault!),
      logs: [closePoLog(business.vault!, ref)],
    };
    const clientWithClose = mockClient({
      getTransactionReceipt: async () => receipt,
    });

    const closed = await recordClosePo(
      db,
      clientWithClose,
      deployment,
      owner,
      business.id,
      closeTx,
      ref,
    );
    expect(closed.poRef).toBe(ref);

    const [row] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.poRef, ref));
    expect(row!.closedAt).not.toBeNull();
    expect(row!.closedTx).toBe(closeTx.toLowerCase());

    // Prepare close again fails with 409
    await expect(
      prepareClosePo(db, client, deployment, owner, business.id, ref),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("listOrders", () => {
  it("enforces business isolation and returns PO views with live lens data", async () => {
    const { owner, member, business, vendorSeal } = await fixture();
    const otherBiz = (
      await db
        .insert(businesses)
        .values({ name: "Other", chainId: arcTestnet.id, vault: address(++vaultNo) })
        .returning()
    )[0]!;

    chainState.getPurchaseOrder.mockResolvedValue({
      open: true,
      seal: vendorSeal,
      remaining: 750_000000n,
      releaseAfter: 0n,
    });

    const client = mockClient();
    // Non-member access throws 403
    await expect(
      listOrders(db, client, deployment, owner, otherBiz.id),
    ).rejects.toMatchObject({ status: 403 });

    const orders = await listOrders(db, client, deployment, member, business.id);
    expect(Array.isArray(orders)).toBe(true);
  });
});

describe("adoptUnrecordedPo (plan 05zj A, SYM-08)", () => {
  it("saves an order the Vault holds but the app never recorded, from its own opening event", async () => {
    const { owner, business, vendorSeal } = await fixture();
    chainDouble.enabled = true;
    const poNum = "PO-LOST-RECORD";
    const ref = computePoRef(poNum);
    const txHash = hash(77);
    const amount = 900_000000n;

    chainState.getPurchaseOrder.mockResolvedValue({ open: true, seal: vendorSeal, remaining: amount, releaseAfter: 0n });
    chainState.scanLogs.mockResolvedValue({ logs: [{ transactionHash: txHash }], scannedTo: 1n });
    const client = mockClient({
      getTransactionReceipt: async () => ({
        status: "success",
        to: getAddress(business.vault!),
        logs: [openPoLog(business.vault!, ref, vendorSeal, hash(0), amount, 0n)],
      }),
    });

    const adopted = await adoptUnrecordedPo(db, client, deployment, owner, business.id, { poNumber: poNum, description: "kept" });
    expect(adopted?.poRef).toBe(ref);
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.poRef, ref));
    expect(row?.poNumber).toBe(poNum);
    expect(row?.amount).toBe(amount);

    // once it is saved there is nothing left to adopt, so the normal "already exists" answer applies
    expect(await adoptUnrecordedPo(db, client, deployment, owner, business.id, { poNumber: poNum })).toBeNull();
  });

  it("adopts nothing when the Vault does not hold that order, or the number does not hash to the event", async () => {
    const { owner, business, vendorSeal } = await fixture();
    chainDouble.enabled = true;
    const client = mockClient();

    chainState.getPurchaseOrder.mockResolvedValue({ open: false, seal: "0x0000000000000000000000000000000000000000", remaining: 0n, releaseAfter: 0n });
    expect(await adoptUnrecordedPo(db, client, deployment, owner, business.id, { poNumber: "PO-NOT-THERE" })).toBeNull();

    // the Vault holds an order under that reference, but the receipt is for a different number: nothing is saved
    const real = computePoRef("PO-REAL");
    chainState.getPurchaseOrder.mockResolvedValue({ open: true, seal: vendorSeal, remaining: 1n, releaseAfter: 0n });
    chainState.scanLogs.mockResolvedValue({ logs: [{ transactionHash: hash(78) }], scannedTo: 1n });
    const mismatched = mockClient({
      getTransactionReceipt: async () => ({ status: "success", to: getAddress(business.vault!), logs: [openPoLog(business.vault!, real, vendorSeal, hash(0), 1n, 0n)] }),
    });
    expect(await adoptUnrecordedPo(db, mismatched, deployment, owner, business.id, { poNumber: "PO-TYPED-WRONG" })).toBeNull();
    const rows = await db.select().from(purchaseOrders).where(eq(purchaseOrders.poRef, computePoRef("PO-TYPED-WRONG")));
    expect(rows).toHaveLength(0);
  });
});

describe("order list recovers an order from the business's own invoice (plan 05zl 1.2, QA 3)", () => {
  async function invoiceNaming(businessVault: string, poNumber: string, businessId: string) {
    const sealKey = privateKeyToAccount(generatePrivateKey());
    const document = completeTotals({
      schema: "symbolon.invoice.v1",
      seal: sealKey.address.toLowerCase(),
      vendor: { name: "Accra Cold Chain" },
      payer: { name: "Kente", vault: businessVault },
      invoiceNumber: "ACCS-" + crypto.randomUUID().slice(0, 6),
      poNumber,
      issuedAt: 1_790_000_000,
      dueDate: 1_792_592_000,
      currency: { chainId: arcTestnet.id, token: deployment.tokens.usdc.toLowerCase(), symbol: "USDC", decimals: 6 },
      lineItems: [{ description: "Work", quantity: "1", unitPrice: "276.80" }],
      taxes: [],
      discounts: [],
      payout: { address: privateKeyToAccount(generatePrivateKey()).address.toLowerCase(), domain: 26 },
      earlyPay: [],
      attachments: [],
    } as never);
    const { sealed, fingerprint } = await sealInvoice({
      signer: sealKey,
      chainId: arcTestnet.id,
      ledger: deployment.contracts.invoiceLedger,
      document,
    });
    await db.insert(invoices).values({
      fingerprint,
      chainId: arcTestnet.id,
      ledger: deployment.contracts.invoiceLedger.toLowerCase(),
      seal: sealKey.address.toLowerCase(),
      businessId,
      payerRef: ("0x" + "00".repeat(12) + businessVault.slice(2).toLowerCase()) as Hex,
      poRef: computePoRef(poNumber),
      invoiceNumber: document.invoiceNumber,
      token: deployment.tokens.usdc.toLowerCase(),
      total: 276_800000n,
      dueDate: new Date(1_792_592_000 * 1000),
      issuedAt: new Date(1_790_000_000 * 1000),
      envelope: encodeSealedInvoice(sealed),
      source: "upload",
      status: "verified",
    });
    return sealKey.address;
  }

  it("lists an order the Vault holds and the app never saved, using the invoice's own PO number", async () => {
    const { owner, business, vendorSeal } = await fixture();
    chainDouble.enabled = true;
    const poNum = "PO-KL-2026-0107";
    const ref = computePoRef(poNum);
    await invoiceNaming(business.vault!, poNum, business.id);
    const amount = 276_800000n;

    chainState.getPurchaseOrder.mockResolvedValue({ open: true, seal: vendorSeal, remaining: amount, releaseAfter: 0n });
    chainState.scanLogs.mockResolvedValue({ logs: [{ transactionHash: hash(91) }], scannedTo: 1n });
    const client = mockClient({
      getTransactionReceipt: async () => ({
        status: "success",
        to: getAddress(business.vault!),
        logs: [openPoLog(business.vault!, ref, vendorSeal, hash(0), amount, 0n)],
      }),
    });

    const list = await listOrders(db, client, deployment, owner, business.id);
    expect(list.map((o) => o.poNumber)).toEqual([poNum]);
  });

  it("saves nothing when the Vault does not hold the order the invoice names, and only the owner's read writes", async () => {
    const { owner, member, business } = await fixture();
    chainDouble.enabled = true;
    await invoiceNaming(business.vault!, "PO-NOT-OPENED", business.id);
    chainState.getPurchaseOrder.mockResolvedValue({ open: false, seal: "0x0000000000000000000000000000000000000000", remaining: 0n, releaseAfter: 0n });
    const client = mockClient();
    expect(await listOrders(db, client, deployment, owner, business.id)).toEqual([]);
    expect(await listOrders(db, client, deployment, member, business.id)).toEqual([]);
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.businessId, business.id))).toHaveLength(0);
  });
});
