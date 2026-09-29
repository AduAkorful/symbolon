import { decodeFunctionData, keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";

import { getDeployment, toTransaction, vaultFactoryAbi } from "@symbolon/chain";
import { createTestDb, earlyPayOffers, invoices, members, seals, users } from "@symbolon/db";
import { sealDomain, signSealMessage, typedData } from "@symbolon/seal";

import { counterOffer, createVaultCall, expireOffers, policyTemplate, recordOffer, registerBusiness, registerSeal } from "../src/index.js";

const CHAIN_ID = 5_042_002;
const LEDGER = "0x7EFf84D0715284FA3d793525151b30a05Af45aCE" as const;
const d = { chainId: CHAIN_ID, ledger: LEDGER };
const seal = privateKeyToAccount(keccak256(stringToBytes("business.seal")));
const other = privateKeyToAccount(keccak256(stringToBytes("business.other")));
const FP = keccak256(stringToBytes("offer-invoice")) as Hex;
const NOW = new Date("2026-09-26T12:00:00Z");
const in1Day = BigInt(Math.floor(NOW.getTime() / 1000) + 86_400);

describe("business setup", () => {
  it("offers templates where strict is the tightest on every limit", () => {
    const [s, m, x] = (["starter", "standard", "strict"] as const).map((t) => policyTemplate(t));
    expect(m!.autoPayLimit).toBe(1_000_000_000n);
    expect(m!.ownerThreshold).toBe(10_000_000_000n);
    expect(m!.changeCooldown).toBe(259_200n);
    for (const t of [s!, m!]) {
      expect(x!.perTxCap < t.perTxCap && x!.autoPayLimit <= t.autoPayLimit && x!.ownerThreshold < t.ownerThreshold).toBe(true);
    }
    expect(x!.newVendorMinPaid > m!.newVendorMinPaid && m!.newVendorMinPaid > s!.newVendorMinPaid).toBe(true);
    expect(x!.looseningDelay > m!.looseningDelay && m!.looseningDelay > s!.looseningDelay).toBe(true);
  });

  it("builds the owner's createVault call on the current factory, auto-update off by default", () => {
    const deployment = getDeployment(CHAIN_ID);
    const call = createVaultCall(deployment, { owner: other.address, policy: policyTemplate("standard") });
    expect(call.address).toBe(deployment.contracts.vaultFactory);
    const { args } = decodeFunctionData({ abi: vaultFactoryAbi, data: toTransaction(call).data });
    expect(args?.[3]).toEqual([deployment.tokens.usdc]);
    expect(args?.[5]).toBe(false);
  });

  it("registers a business with its owner, and Seals with valid, unreserved handles", async () => {
    const db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "ana@studio.example" }).returning();
    const { id } = await registerBusiness(db, { name: " Acme ", chainId: CHAIN_ID, ownerUserId: u!.id });
    expect(await db.select().from(members)).toEqual([expect.objectContaining({ businessId: id, role: "owner" })]);
    await registerSeal(db, { userId: u!.id, address: seal.address, handle: "Studio-Ana", displayName: "Studio Ana" });
    expect((await db.select().from(seals))[0]!.handle).toBe("studio-ana");
    for (const bad of ["a", "-ana", "ana-", "verify", "ana ana"]) {
      await expect(registerSeal(db, { userId: u!.id, address: other.address, handle: bad, displayName: "X" })).rejects.toThrow();
    }
  });
});

describe("Early Pay offers", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(invoices).values({
      fingerprint: FP,
      chainId: CHAIN_ID,
      ledger: LEDGER.toLowerCase(),
      seal: seal.address.toLowerCase(),
      payerRef: `0x${"00".repeat(32)}`,
      invoiceNumber: "INV-1",
      token: "0x3600000000000000000000000000000000000000",
      total: 1_000_000_000n,
      dueDate: new Date("2026-10-26T00:00:00Z"),
      envelope: "{}",
      source: "link",
    });
  });

  const sign = (signer = seal, bps = 200, validUntil = in1Day) =>
    signSealMessage(signer, typedData(sealDomain(CHAIN_ID, LEDGER), "EarlyPayOffer", { fingerprint: FP, discountBps: bps, validUntil }));

  it("stores a cash-now offer signed by the invoice's Seal", async () => {
    await recordOffer(db, d, { fingerprint: FP, discountBps: 200, validUntil: in1Day, signature: await sign() }, { now: NOW });
    expect(await db.select().from(earlyPayOffers)).toEqual([expect.objectContaining({ discountBps: 200, status: "open" })]);
  });

  it("refuses offers signed by anyone else, on other terms, expired or out of range", async () => {
    await expect(recordOffer(db, d, { fingerprint: FP, discountBps: 200, validUntil: in1Day, signature: await sign(other) }, { now: NOW })).rejects.toThrow(/Seal/);
    await expect(recordOffer(db, d, { fingerprint: FP, discountBps: 300, validUntil: in1Day, signature: await sign() }, { now: NOW })).rejects.toThrow(/Seal/);
    await expect(recordOffer(db, d, { fingerprint: FP, discountBps: 200, validUntil: 1n, signature: await sign(seal, 200, 1n) }, { now: NOW })).rejects.toThrow(/expired/);
    await expect(recordOffer(db, d, { fingerprint: FP, discountBps: 5_001, validUntil: in1Day, signature: "0x" }, { now: NOW })).rejects.toThrow(/range/);
  });

  it("counters once, and expires stale offers", async () => {
    await counterOffer(db, { fingerprint: FP, discountBps: 120, validUntil: new Date(NOW.getTime() + 3_600_000) });
    await expect(counterOffer(db, { fingerprint: FP, discountBps: 100, validUntil: NOW })).rejects.toThrow(/once/);
    await recordOffer(db, d, { fingerprint: FP, discountBps: 200, validUntil: in1Day, signature: await sign() }, { now: NOW });
    expect(await expireOffers(db, new Date(Number(in1Day + 1n) * 1000))).toBe(1);
  });
});
