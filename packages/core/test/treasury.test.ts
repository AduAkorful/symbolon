import { eq } from "drizzle-orm";
import { decodeFunctionData, type Hex, type PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { symbolonVaultAbi, toTransaction, type Deployment, type SymbolonContracts } from "@symbolon/chain";
import { businesses, chainEvents, createTestDb, decisions, invoices } from "@symbolon/db";
import { DEFAULT_EARLY_PAY, type StewardWallet } from "@symbolon/steward";

import { paymentsCsv, runTreasury } from "../src/index.js";

const VAULT = "0x5f5e2cd9f87a81724cc48ec0c193630a60692984";
const TELLER = "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A";
const USDC = 1_000_000n;
const NOW = 1_790_000_000n;

function env(db: Awaited<ReturnType<typeof createTestDb>>, status: Record<string, unknown>, wallet?: StewardWallet) {
  const teller = {
    read: {
      todayTimestamp: async () => NOW,
      previewDepositData: async ([, assets]: [string, bigint]) => [(assets * 10n ** 18n) / 1_138_000_000_000_000_000n, 0n, 1_138_000_000_000_000_000n],
      previewRedeemData: async ([, shares]: [string, bigint]) => [(shares * 1_138_000_000_000_000_000n) / 10n ** 18n, 0n, 1_138_000_000_000_000_000n],
      subscriptionLimitRemaining: async () => 1_000_000n * USDC,
      redemptionLimitRemaining: async () => 1_000_000n * USDC,
    },
  };
  const contracts = { lens: { read: { reserveStatus: async () => status } }, teller } as unknown as SymbolonContracts;
  const client = { getBlock: async () => ({ timestamp: NOW }), simulateContract: vi.fn(async () => ({ request: {} })) } as unknown as PublicClient;
  return { db, client, contracts, deployment: {} as Deployment, program: DEFAULT_EARLY_PAY, bufferDays: 30, reserveYieldBps: 320, ...(wallet ? { wallet } : {}) };
}

const status = (o: Record<string, unknown> = {}) => ({
  usycTeller: TELLER,
  usyc: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
  entitled: true,
  cash: 300_000n * USDC,
  shares: 0n,
  reserveValue: 0n,
  policy: { enabled: true, maxReserveBps: 8_000, minOperating: 50_000n * USDC },
  ...o,
});

describe("treasury run", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let businessId: string;
  beforeEach(async () => {
    db = await createTestDb();
    const [b] = await db.insert(businesses).values({ name: "Acme", chainId: 5_042_002, vault: VAULT, stewardMode: "auto" }).returning();
    businessId = b!.id;
    await db.insert(invoices).values({
      fingerprint: `0x${"aa".repeat(32)}`,
      chainId: 5_042_002,
      ledger: `0x${"11".repeat(20)}`,
      seal: `0x${"22".repeat(20)}`,
      businessId,
      payerRef: `0x${"00".repeat(32)}`,
      invoiceNumber: "INV-1",
      token: `0x${"36".repeat(20)}`,
      total: 100_000n * USDC,
      dueDate: new Date(Number(NOW + 10n * 86_400n) * 1000),
      envelope: "{}",
      status: "scheduled",
      source: "link",
    });
  });

  it("sweeps the excess over the 30-day buffer with a Teller-previewed min-out, and records it", async () => {
    const send = vi.fn(async () => `0x${"bb".repeat(32)}` as Hex);
    const r = await runTreasury(env(db, status(), { address: "0x0000000000000000000000000000000000000abc", send }), businessId);
    expect(r.action).toBe("subscribe");
    const { functionName, args } = decodeFunctionData({ abi: symbolonVaultAbi, data: toTransaction(r.call!).data });
    expect(functionName).toBe("subscribeReserve");
    const [assets, minShares, decisionHash] = args as [bigint, bigint, Hex];
    expect(assets).toBe(200_000n * USDC); // 300k cash − 100k due within 30 days
    expect(minShares).toBe(((200_000n * USDC * 10n ** 18n) / 1_138_000_000_000_000_000n * 9_950n) / 10_000n);
    expect(decisionHash).toBe(r.hash);
    expect(send).toHaveBeenCalledOnce();
    expect(await db.select().from(decisions)).toHaveLength(1);
  });

  it("redeems ahead of a bill due within the lead time", async () => {
    await db.update(invoices).set({ dueDate: new Date(Number(NOW + 86_400n) * 1000) });
    const r = await runTreasury(env(db, status({ cash: 40_000n * USDC, shares: 87_000n * USDC, reserveValue: 99_000n * USDC })), businessId);
    expect(r.action).toBe("redeem");
    expect(decodeFunctionData({ abi: symbolonVaultAbi, data: toTransaction(r.call!).data }).functionName).toBe("redeemReserve");
  });

  it("does nothing for a Vault without the reserve, switched off, or not allowlisted", async () => {
    expect((await runTreasury(env(db, status({ usycTeller: "0x0000000000000000000000000000000000000000" })), businessId)).action).toBe("none");
    expect((await runTreasury(env(db, status({ policy: { enabled: false, maxReserveBps: 0, minOperating: 0n } })), businessId)).action).toBe("none");
    expect((await runTreasury(env(db, status({ entitled: false })), businessId)).reason).toMatch(/allowlisted/);
    expect(await db.select().from(decisions)).toHaveLength(0);
  });

  it("deduplicates treasury decision rows across consecutive shadow runs with the same plan per T10", async () => {
    await db.update(businesses).set({ stewardMode: "shadow" }).where(eq(businesses.id, businessId));
    const r1 = await runTreasury(env(db, status()), businessId);
    expect(r1.action).toBe("subscribe");
    expect(await db.select().from(decisions)).toHaveLength(1);

    const r2 = await runTreasury(env(db, status()), businessId);
    expect(r2.action).toBe("subscribe");
    expect(await db.select().from(decisions)).toHaveLength(1);
  });
});

describe("payments export", () => {
  it("lists settled payments at full precision and neutralises spreadsheet formulas", async () => {
    const db = await createTestDb();
    const [b] = await db.insert(businesses).values({ name: "Acme", chainId: 5_042_002, vault: VAULT }).returning();
    const fp = `0x${"cc".repeat(32)}`;
    await db.insert(invoices).values({
      fingerprint: fp,
      chainId: 5_042_002,
      ledger: `0x${"11".repeat(20)}`,
      seal: `0x${"22".repeat(20)}`,
      businessId: b!.id,
      payerRef: `0x${"00".repeat(32)}`,
      invoiceNumber: "=HYPERLINK(\"x\")",
      token: `0x${"36".repeat(20)}`,
      total: 4_326_000_001n,
      dueDate: new Date(),
      envelope: "{}",
      source: "link",
    });
    await db.insert(chainEvents).values({
      chainId: 5_042_002,
      txHash: `0x${"dd".repeat(32)}`,
      logIndex: 2,
      blockNumber: 100n,
      address: `0x${"11".repeat(20)}`,
      eventName: "Settled",
      args: { fingerprint: fp, credit: "4326000001", paid: "4261110001", discountBps: 150, payoutDomain: 26, payoutAddress: "0xABC" },
    });
    const csv = await paymentsCsv(db, b!.id);
    const [header, row] = csv.trim().split("\n");
    expect(header).toMatch(/^block,tx_hash,fingerprint/);
    expect(row).toContain("4326.000001");
    expect(row).toContain("4261.110001");
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
