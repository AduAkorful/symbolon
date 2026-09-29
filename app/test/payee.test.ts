import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import { createTestDb, businesses, decisions, members, seals, users } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex, type PublicClient } from "viem";

const chainState = vi.hoisted(() => ({ getPayee: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@symbolon/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@symbolon/chain")>()),
  symbolonContracts: () => ({ lens: { read: { getPayee: chainState.getPayee } }, ledger: { read: { localDomain: async () => 26 } } }),
}));

import { recordPayee } from "@/lib/server/payee";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });
beforeEach(() => chainState.getPayee.mockReset());

const address = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const terms = { budget: hash(1), requirePo: true, requireDelivery: false, monthlyCap: 75n };
const deployment = getDeployment(arcTestnet.id);
let vaultNo = 1;

async function fixture() {
  const [owner] = await db.insert(users).values({ email: "payee-owner-" + crypto.randomUUID() + "@example.test" }).returning();
  const [vendor] = await db.insert(users).values({ email: "payee-vendor-" + crypto.randomUUID() + "@example.test" }).returning();
  const [business] = await db.insert(businesses).values({ name: "Northwind", chainId: arcTestnet.id, vault: address(++vaultNo) }).returning();
  await db.insert(members).values({ businessId: business!.id, userId: owner!.id, role: "owner" });
  await db.insert(seals).values({ address: address(3), userId: vendor!.id, handle: "vendor-" + crypto.randomUUID().slice(0, 8), displayName: "Vendor", payoutAddress: address(2) }).onConflictDoNothing();
  return { owner: owner!, business: business! };
}

function addedLog(vault: string, seal: string, payout = address(2), payoutDomain = 26) {
  return {
    address: getAddress(vault),
    topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "PayeeAdded", args: { seal: getAddress(seal) } }),
    data: encodeAbiParameters([
      { type: "address" },
      { type: "uint32" },
      { type: "uint64" },
      { type: "tuple", components: [
        { name: "budget", type: "bytes32" },
        { name: "requirePo", type: "bool" },
        { name: "requireDelivery", type: "bool" },
        { name: "monthlyCap", type: "uint256" },
      ] },
    ], [getAddress(payout), payoutDomain, 123n, terms]),
  };
}

function clientFor(receipt: object) {
  return { getTransactionReceipt: async () => receipt } as unknown as PublicClient;
}

describe("payee receipt confirmation", () => {
  it.each([
    ["another Vault", (vault: string) => ({ status: "success", to: address(9), logs: [addedLog(vault, address(3))] })],
    ["a different Seal", (vault: string) => ({ status: "success", to: vault, logs: [addedLog(vault, address(4))] })],
    ["a failed transaction", (vault: string) => ({ status: "reverted", to: vault, logs: [addedLog(vault, address(3))] })],
    ["duplicate PayeeAdded events", (vault: string) => ({ status: "success", to: vault, logs: [addedLog(vault, address(3)), addedLog(vault, address(3))] })],
  ])("does not record a payee from a receipt for %s", async (_name, makeReceipt) => {
    const { owner, business } = await fixture();
    const receipt = makeReceipt(business.vault!) as object;
    await expect(recordPayee(db, clientFor(receipt), deployment, owner, business.id, hash(90), address(3)))
      .rejects.toBeInstanceOf(AuthError);
    expect(await db.select().from(decisions).where(eq(decisions.businessId, business.id))).toHaveLength(0);
  });

  it("does not record the event if the live Vault payee facts disagree with it", async () => {
    const { owner, business } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(8), payoutDomain: 26, activeAt: 123n, terms });
    await expect(recordPayee(db, clientFor({ status: "success", to: business.vault, logs: [addedLog(business.vault!, address(3))] }), deployment, owner, business.id, hash(91), address(3)))
      .rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(decisions).where(eq(decisions.businessId, business.id))).toHaveLength(0);
  });

  it("does not record a receipt whose payout was never signed by the vendor", async () => {
    const { owner, business } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(8), payoutDomain: 26, activeAt: 123n, terms });
    await expect(recordPayee(db, clientFor({ status: "success", to: business.vault, logs: [addedLog(business.vault!, address(3), address(8))] }), deployment, owner, business.id, hash(94), address(3)))
      .rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(decisions).where(eq(decisions.businessId, business.id))).toHaveLength(0);
  });

  it("does not record an allowed payout on an unsigned domain", async () => {
    const { owner, business } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(2), payoutDomain: 27, activeAt: 123n, terms });
    await expect(recordPayee(db, clientFor({ status: "success", to: business.vault, logs: [addedLog(business.vault!, address(3), address(2), 27)] }), deployment, owner, business.id, hash(95), address(3)))
      .rejects.toMatchObject({ status: 409 });
    expect(await db.select().from(decisions).where(eq(decisions.businessId, business.id))).toHaveLength(0);
  });

  it("records only a matching successful receipt and current Vault payee record", async () => {
    const { owner, business } = await fixture();
    chainState.getPayee.mockResolvedValue({ exists: true, payout: address(2), payoutDomain: 26, activeAt: 123n, terms });
    const result = await recordPayee(db, clientFor({ status: "success", to: business.vault, logs: [addedLog(business.vault!, address(3))] }), deployment, owner, business.id, hash(92), address(3));
    expect(result).toMatchObject({ seal: getAddress(address(3)).toLowerCase(), payout: getAddress(address(2)), activeAt: "123" });
    expect(await db.select().from(decisions).where(eq(decisions.businessId, business.id))).toHaveLength(1);
  });

  it("does not let a member of another business record a receipt against this Vault", async () => {
    const first = await fixture();
    const second = await fixture();
    await expect(recordPayee(db, clientFor({}), deployment, second.owner, first.business.id, hash(93), address(3)))
      .rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(decisions).where(eq(decisions.businessId, first.business.id))).toHaveLength(0);
  });
});
