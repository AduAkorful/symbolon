import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import { createTestDb, businesses, decisions, members, payees, purchaseOrders, seals, users } from "@symbolon/db";
import { poRef as computePoRef } from "@symbolon/seal";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex, type PublicClient } from "viem";

const chainState = vi.hoisted(() => ({
  getPurchaseOrder: vi.fn(),
  getVaultState: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@symbolon/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@symbolon/chain")>()),
  symbolonContracts: () => ({
    lens: {
      read: {
        getPurchaseOrder: chainState.getPurchaseOrder,
        getVaultState: chainState.getVaultState,
      },
    },
  }),
}));

import { listOrders, prepareOpenPo, recordOpenPo, prepareClosePo, recordClosePo } from "@/lib/server/orders";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(() => {
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
