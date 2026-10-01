import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import { createTestDb, businesses, decisions, members, payees, screenings, seals, users } from "@symbolon/db";
import { Risk } from "@symbolon/steward";
import { and, eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex, type PublicClient } from "viem";

const chainState = vi.hoisted(() => ({
  getPayee: vi.fn(),
  getVaultState: vi.fn(),
  getBlock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@symbolon/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@symbolon/chain")>()),
  symbolonContracts: () => ({
    lens: {
      read: {
        getPayee: chainState.getPayee,
        getVaultState: chainState.getVaultState,
      },
    },
    ledger: { read: { localDomain: async () => 26 } },
  }),
}));

import {
  complianceReport,
  describeTiers,
  loadComplianceView,
  prepareScreeningWrite,
  recordScreeningWrite,
  screenPayee,
} from "@/lib/server/compliance";
import { AuthError } from "@/lib/server/errors";
import type { ScreeningProvider, ScreeningResult } from "@symbolon/core";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
beforeEach(() => {
  chainState.getPayee.mockReset();
  chainState.getVaultState.mockReset();
  chainState.getBlock.mockReset();
});

const address = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const deployment = getDeployment(arcTestnet.id);
let vaultNo = 100;
let sealNo = 20;

async function fixture() {
  const [owner] = await db.insert(users).values({ email: "comp-owner-" + crypto.randomUUID() + "@example.test" }).returning();
  const [approver] = await db.insert(users).values({ email: "comp-appr-" + crypto.randomUUID() + "@example.test" }).returning();
  const [viewer] = await db.insert(users).values({ email: "comp-view-" + crypto.randomUUID() + "@example.test" }).returning();
  const [vendor] = await db.insert(users).values({ email: "comp-vendor-" + crypto.randomUUID() + "@example.test" }).returning();

  const [business] = await db
    .insert(businesses)
    .values({ name: "Compliance Corp", chainId: arcTestnet.id, vault: address(++vaultNo) })
    .returning();

  await db.insert(members).values([
    { businessId: business!.id, userId: owner!.id, role: "owner" },
    { businessId: business!.id, userId: approver!.id, role: "approver" },
    { businessId: business!.id, userId: viewer!.id, role: "viewer" },
  ]);

  const sealAddr = address(++sealNo);
  await db.insert(seals).values({
    address: sealAddr,
    userId: vendor!.id,
    handle: "vendor-" + crypto.randomUUID().slice(0, 8),
    displayName: "Acme Vendor",
    payoutAddress: address(21),
  }).onConflictDoNothing();

  await db.insert(payees).values({
    businessId: business!.id,
    seal: sealAddr,
    status: "verified",
    verificationMethod: "known-channel",
    verifiedAt: new Date(),
    verifiedBy: owner!.id,
  });

  return { owner: owner!, approver: approver!, viewer: viewer!, vendor: vendor!, business: business!, seal: sealAddr };
}

function screeningLog(vault: string, seal: string, risk = 0, screenedAt = 1234567890n) {
  return {
    address: getAddress(vault),
    topics: encodeEventTopics({
      abi: symbolonVaultAbi,
      eventName: "ScreeningSet",
      args: { seal: getAddress(seal) },
    }),
    data: encodeAbiParameters(
      [{ type: "uint8" }, { type: "uint64" }],
      [risk, screenedAt],
    ),
  };
}

function clientFor(receipt: object, blockTime = 1234567900n) {
  return {
    getTransactionReceipt: async () => receipt,
    getBlock: async () => ({ timestamp: blockTime }),
  } as unknown as PublicClient;
}

const mockProvider = (overrides: Partial<ScreeningResult> = {}): ScreeningProvider => ({
  screen: async (addr) => ({
    address: addr,
    risk: Risk.Low,
    result: "APPROVED",
    ruleName: "test-rule",
    actions: ["APPROVE"],
    categories: ["CLEAN"],
    screenedAt: new Date("2026-09-30T10:00:00Z"),
    provider: "mock-compliance",
    ...overrides,
  }),
});

describe("Compliance screening service (05s Part A)", () => {
  it("screenPayee: screens a payee, records in screenings table, and returns result", async () => {
    const { owner, business, seal } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(21), pendingActiveAt: 0n });

    const provider = mockProvider();
    const cfg = { chainId: arcTestnet.id, testnet: true, deployment, appOrigin: "http://localhost:3000", production: false };
    const row = await screenPayee(
      db,
      cfg,
      owner,
      business.id,
      seal,
      { provider },
    );

    expect(row.risk).toBe(0);
    expect(row.result).toBe("APPROVED");
    expect(row.address.toLowerCase()).toBe(address(21).toLowerCase());

    const stored = await db.select().from(screenings).where(eq(screenings.id, row.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.ruleName).toBe("test-rule");
    expect(stored[0]!.actions).toEqual(["APPROVE"]);
  });

  it("screenPayee: approver can screen, but viewer gets 403", async () => {
    const { approver, viewer, business, seal } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(21), pendingActiveAt: 0n });

    const cfg = { chainId: arcTestnet.id, testnet: true, deployment, appOrigin: "http://localhost:3000", production: false };
    const provider = mockProvider();

    // Approver succeeds
    const row = await screenPayee(db, cfg, approver, business.id, seal, { provider });
    expect(row.result).toBe("APPROVED");

    // Viewer forbidden
    await expect(screenPayee(db, cfg, viewer, business.id, seal, { provider })).rejects.toBeInstanceOf(AuthError);
  });

  it("screenPayee: marks payee blocked offchain when provider returns Blocked", async () => {
    const { owner, business, seal } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(21), pendingActiveAt: 0n });

    const provider = mockProvider({ risk: Risk.Blocked, result: "DENIED", actions: ["DENY"] });
    const cfg = { chainId: arcTestnet.id, testnet: true, deployment, appOrigin: "http://localhost:3000", production: false };

    const row = await screenPayee(db, cfg, owner, business.id, seal, { provider });
    expect(row.risk).toBe(Risk.Blocked);
    expect(row.result).toBe("DENIED");

    // Payee should now be blocked offchain in payees table
    const [payeeRow] = await db.select().from(payees).where(and(eq(payees.businessId, business.id), eq(payees.seal, seal)));
    expect(payeeRow!.status).toBe("blocked");

    // Decision appended
    const decs = await db.select().from(decisions).where(eq(decisions.businessId, business.id));
    expect(decs.some((d) => d.kind === "block_seal")).toBe(true);
  });

  it("screenPayee: provider failure is a 502, never treated as clean", async () => {
    const { owner, business, seal } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(21), pendingActiveAt: 0n });

    const failingProvider: ScreeningProvider = {
      screen: async () => {
        throw new Error("Circle compliance API 500 internal error");
      },
    };
    const cfg = { chainId: arcTestnet.id, testnet: true, deployment, appOrigin: "http://localhost:3000", production: false };

    await expect(screenPayee(db, cfg, owner, business.id, seal, { provider: failingProvider })).rejects.toMatchObject({
      status: 502,
    });
  });

  it("screenPayee: throws 502 when no client and no provider injected (can't read lens)", async () => {
    const { owner, business, seal } = await fixture();
    // No client, no provider → can't call lens → 502
    const cfg = { chainId: arcTestnet.id, testnet: true, deployment, appOrigin: "http://localhost:3000", production: false };
    await expect(screenPayee(db, cfg, owner, business.id, seal)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("Can't confirm this Vault's payees right now"),
    });
  });

  it("screenPayee: throws 502 when Circle key missing but client present and no provider", async () => {
    const { owner, business, seal } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(21), pendingActiveAt: 0n });

    const cfgNoCircle = { chainId: arcTestnet.id, testnet: true, deployment, appOrigin: "http://localhost:3000", production: false };
    // client injected so lens read works; provider missing and Circle key absent → 502 Circle
    await expect(
      screenPayee(db, cfgNoCircle, owner, business.id, seal, { client: clientFor({}) as any, deployment }),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("Circle's Compliance Engine isn't enabled"),
    });
  });

  it("prepareScreeningWrite: requires owner and returns valid setScreening call", async () => {
    const { owner, approver, business, seal } = await fixture();
    const screenedAt = new Date("2026-09-30T10:00:00Z");
    const [screeningRow] = await db
      .insert(screenings)
      .values({
        businessId: business.id,
        seal,
        address: address(21),
        risk: 0,
        result: "APPROVED",
        provider: "circle",
        screenedAt,
        createdBy: owner.id,
      })
      .returning();

    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(21) });
    const blockTime = BigInt(Math.floor(screenedAt.getTime() / 1000)) + 60n;
    const client = clientFor({}, blockTime);

    // Approver cannot prepare (owner only)
    await expect(prepareScreeningWrite(db, client, deployment, approver, business.id, screeningRow!.id)).rejects.toBeInstanceOf(AuthError);

    // Owner succeeds
    const prepared = await prepareScreeningWrite(db, client, deployment, owner, business.id, screeningRow!.id);
    expect(prepared.to.toLowerCase()).toBe(business.vault!.toLowerCase());
    expect(prepared.chainId).toBe(arcTestnet.id);
    expect(prepared.summary.risk).toBe(0);
    expect(prepared.summary.screeningId).toBe(screeningRow!.id);
  });

  it("prepareScreeningWrite: refuses if screening timestamp is in the future of the chain block", async () => {
    const { owner, business, seal } = await fixture();
    const screenedAt = new Date("2026-09-30T10:00:00Z");
    const [screeningRow] = await db
      .insert(screenings)
      .values({
        businessId: business.id,
        seal,
        address: address(21),
        risk: 0,
        result: "APPROVED",
        provider: "circle",
        screenedAt,
        createdBy: owner.id,
      })
      .returning();

    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(21) });
    // Block time is BEFORE screenedAt
    const blockTime = BigInt(Math.floor(screenedAt.getTime() / 1000)) - 60n;
    const client = clientFor({}, blockTime);

    await expect(prepareScreeningWrite(db, client, deployment, owner, business.id, screeningRow!.id)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("recordScreeningWrite: confirms receipt, verifies event & lens, appends decision", async () => {
    const { owner, business, seal } = await fixture();
    const screenedAt = new Date("2026-09-30T10:00:00Z");
    const screenedAtSec = BigInt(Math.floor(screenedAt.getTime() / 1000));
    const [screeningRow] = await db
      .insert(screenings)
      .values({
        businessId: business.id,
        seal,
        address: address(21),
        risk: 1,
        result: "APPROVED",
        provider: "circle",
        screenedAt,
        createdBy: owner.id,
      })
      .returning();

    const txHash = hash(77);
    const receipt = {
      status: "success",
      to: business.vault,
      logs: [screeningLog(business.vault!, seal, 1, screenedAtSec)],
    };
    const client = clientFor(receipt);
    chainState.getPayee.mockResolvedValue({ exists: true, risk: 1, screenedAt: screenedAtSec });

    const result = await recordScreeningWrite(db, client, deployment, owner, business.id, txHash, screeningRow!.id);
    expect(result.ok).toBe(true);
    expect(result.risk).toBe(1);

    // Decision appended
    const decs = await db.select().from(decisions).where(eq(decisions.businessId, business.id));
    const recordedDec = decs.find((d) => d.kind === "screening_recorded");
    expect(recordedDec).toBeDefined();
    expect(((recordedDec!.record as Record<string, unknown>).inputs as Record<string, unknown>).screeningId).toBe(screeningRow!.id);
    expect(recordedDec!.txHash).toBe(txHash);

    // Idempotent on same txHash
    const retry = await recordScreeningWrite(db, client, deployment, owner, business.id, txHash, screeningRow!.id);
    expect(retry.ok).toBe(true);
  });

  it("recordScreeningWrite: rejects mismatched receipt or failed tx", async () => {
    const { owner, business, seal } = await fixture();
    const screenedAt = new Date("2026-09-30T10:00:00Z");
    const screenedAtSec = BigInt(Math.floor(screenedAt.getTime() / 1000));
    const [screeningRow] = await db
      .insert(screenings)
      .values({
        businessId: business.id,
        seal,
        address: address(21),
        risk: 0,
        result: "APPROVED",
        provider: "circle",
        screenedAt,
        createdBy: owner.id,
      })
      .returning();

    // Reverted tx
    await expect(
      recordScreeningWrite(
        db,
        clientFor({ status: "reverted", to: business.vault, logs: [] }),
        deployment,
        owner,
        business.id,
        hash(88),
        screeningRow!.id,
      ),
    ).rejects.toBeInstanceOf(AuthError);

    // Wrong seal in event
    await expect(
      recordScreeningWrite(
        db,
        clientFor({ status: "success", to: business.vault, logs: [screeningLog(business.vault!, address(99), 0, screenedAtSec)] }),
        deployment,
        owner,
        business.id,
        hash(89),
        screeningRow!.id,
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("complianceReport: exports sanitized CSV with headers and row data", async () => {
    const { owner, business, seal } = await fixture();
    const screenedAt = new Date("2026-09-30T10:00:00Z");
    await db.insert(screenings).values({
      businessId: business.id,
      seal,
      address: address(21),
      risk: 0,
      result: "APPROVED",
      ruleName: "=CMD|' /C calc'!A0", // formula injection attempt
      actions: ["APPROVE"],
      categories: ["CLEAN"],
      provider: "circle",
      screenedAt,
      createdBy: owner.id,
    });

    const csv = await complianceReport(db, business.id);
    expect(csv).toContain("Counterparty,Seal,Address,Risk,Result,Rule,Screened at,Transaction,Decision");
    expect(csv).toContain("Acme Vendor");
    // Formula neutralized with leading quote
    expect(csv).toContain("'=CMD");
  });

  it("describeTiers: matches Vault policy approval levels", () => {
    const tiers = describeTiers({
      screeningMaxAge: 30n * 86400n,
      ownerThreshold: 10_000n,
      autoPayLimit: 1_000n,
      newVendorMinPaid: 3,
    });
    expect(tiers.find((t) => t.tier === "Low")?.action).toMatch(/normal/i);
    expect(tiers.find((t) => t.tier === "Medium")?.action).toMatch(/approver/i);
    expect(tiers.find((t) => t.tier === "High")?.action).toMatch(/owner/i);
    expect(tiers.find((t) => t.tier === "Blocked")?.action).toMatch(/cannot be paid/i);
  });

  it("failed policy and payee reads are unknown, never reassuring", async () => {
    const { owner, business } = await fixture();
    chainState.getVaultState.mockRejectedValue(new Error("offline"));
    chainState.getPayee.mockRejectedValue(new Error("offline"));
    const view = await loadComplianceView(db, clientFor({}), deployment, owner, business.id);
    expect(view.tiers).toEqual([]);
    expect(view.policyAvailable).toBe(false);
    expect(view.counterparties[0]!.riskLabel).toBe("Unavailable");
    expect(view.counterparties[0]!.status).toBe("unavailable");
    expect(view.counterparties[0]!.payoutAddress).toBeNull();
  });

  it("loadComplianceView: returns view model for all counterparties", async () => {
    const { owner, business, seal } = await fixture();
    chainState.getVaultState.mockResolvedValue({
      exists: true,
      policy: { screeningMaxAge: 30n * 86400n, ownerThreshold: 10_000n, autoPayLimit: 1_000n, newVendorMinPaid: 3 },
    });
    chainState.getPayee.mockResolvedValue({
      exists: true,
      payout: address(21),
      payoutDomain: 26,
      risk: 0,
      screenedAt: 1727690000n,
      activeAt: 100n,
      paidCount: 1,
      terms: { budget: hash(1), requirePo: false, requireDelivery: false, monthlyCap: 1000n },
    });

    const view = await loadComplianceView(db, clientFor({}), deployment, owner, business.id);
    expect(view.counterparties).toHaveLength(1);
    expect(view.counterparties[0]!.name).toBe("Acme Vendor");
    expect(view.counterparties[0]!.payoutAddress!.toLowerCase()).toBe(address(21).toLowerCase());
    expect(view.counterparties[0]!.riskLabel).toBe("Low");
    expect(view.canScreen).toBe(true);
    expect(view.canWrite).toBe(true);
  });
});
