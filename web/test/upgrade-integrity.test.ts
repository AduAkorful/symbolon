import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getDeployment, arcTestnet, symbolonVaultAbi } from "@symbolon/chain";
import { businesses, createTestDb, decisions, members, payees, users } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { encodeEventTopics, encodeFunctionData, getAddress, zeroAddress, type Hex, type PublicClient } from "viem";
import { prepareUpgrade, recordUpgrade } from "@/lib/server/release";

const deployment = getDeployment(arcTestnet.id);
const address = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
const txHash = `0x${"ab".repeat(32)}` as Hex;
let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });
let counter = 11000;
async function fixture() {
  const [owner] = await db.insert(users).values({ wallet: address(++counter).toLowerCase() }).returning();
  const vault = address(++counter); const implementation = deployment.contracts.vaultImplementation;
  const [business] = await db.insert(businesses).values({ name: "Integrity", chainId: deployment.chainId, vault: vault.toLowerCase() }).returning();
  if (!owner || !business) throw new Error("fixture failed");
  await db.insert(members).values({ businessId: business.id, userId: owner.id, role: "owner" });
  const state = { owner: owner.wallet, pendingOwner: zeroAddress, steward: address(++counter), screener: zeroAddress, paused: true,
    accountingDecimals: 6, autoUpdate: false, policy: { perTxCap: 1000n, autoPayLimit: 500n, ownerThreshold: 1000n, newVendorMinPaid: 1,
      screeningMaxAge: 0n, newPayeeDelay: 0n, changeCooldown: 10n, looseningDelay: 20n, maxBridgeFee: 1n } };
  await db.insert(payees).values({ businessId: business.id, seal: address(++counter).toLowerCase() });
  const input = encodeFunctionData({ abi: symbolonVaultAbi, functionName: "upgradeToAndCall", args: [implementation, "0x"] });
  const receipt = { status: "success", to: vault, from: owner.wallet, blockNumber: 20n, logs: [{ address: vault,
    topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "Upgraded", args: { implementation } }), data: "0x" }] };
  const transaction = { to: vault, from: owner.wallet!, input };
  let after = false; let changed: string | undefined; let unavailable = false;
  const readContract = vi.fn(async ({ functionName, blockNumber }: { functionName: string; blockNumber?: bigint }) => {
    if (after && unavailable && blockNumber === 20n) throw new Error("offline");
    if (functionName === "latest") return [implementation, 2n];
    if (functionName === "release") return { revoked: false, publishedAt: 1n };
    if (functionName === "scheduledUpgrade") return 200n;
    if (functionName === "getVaultState") return { ...state, ...(after && changed === "vaultState" ? { screener: address(900) } : {}) };
    if (functionName === "getReservePolicy") return { enabled: after && changed === "reservePolicy", maxReserveBps: 5000, minOperating: 10n };
    if (functionName === "balanceOf") return after && changed === "balances" ? 10n : 1n;
    if (functionName === "getPayee") return { exists: true, payout: after && changed === "payees" ? address(123) : address(124) };
    if (functionName === "getBudget") return { exists: true, cap: after && changed === "budgets" ? 200n : 100n, spent: 0n, periodLength: 30n, periodIndex: 1n };
    if (functionName === "approverBudgetCount") return after && changed === "roles" ? 2n : 1n;
    if (["isRequester", "isApprover", "isSupportedToken"].includes(functionName)) return true;
    throw new Error(`Unexpected ${functionName}`);
  });
  const client = { getBlock: async () => ({ timestamp: 300n }), getBlockNumber: async () => 10n, readContract,
    getTransactionReceipt: async () => receipt, getTransaction: async () => transaction } as unknown as PublicClient;
  const prep = await prepareUpgrade(db, client, deployment, owner, business.id);
  return { owner, business, vault, implementation, client, prep, receipt, transaction, readContract,
    change: (category?: string) => { after = true; changed = category; }, offline: () => { after = true; unavailable = true; } };
}

describe("upgrade server-owned verification boundary", () => {
  it("persists server snapshot and rejects missing, forged and another business operation", async () => {
    const f = await fixture(); const other = await fixture();
    const [row] = await db.select().from(decisions).where(eq(decisions.subject, f.prep.operationId));
    expect(row?.kind).toBe("upgrade_prepared");
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash)).rejects.toThrow(/missing/);
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, crypto.randomUUID())).rejects.toThrow(/missing/);
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, other.prep.operationId)).rejects.toThrow(/missing/);
    const saved = row!.record as { inputs: { snapshot: { state: Record<string, unknown> } } };
    saved.inputs.snapshot.state.balances = [];
    await expect(db.update(decisions).set({ record: saved }).where(eq(decisions.id, row!.id))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/) } });
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, saved as unknown as string)).rejects.toThrow(/missing/);
  });
  it("requires event emitter, calldata, owner and receipt block to match the prepared operation", async () => {
    const f = await fixture();
    f.receipt.logs[0]!.address = address(999);
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, f.prep.operationId)).rejects.toThrow(/event/);
    f.receipt.logs[0]!.address = f.vault; f.transaction.input = "0x";
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, f.prep.operationId)).rejects.toThrow(/prepared/);
    f.transaction.input = f.prep.data; f.transaction.from = address(999);
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, f.prep.operationId)).rejects.toThrow(/prepared/);
    f.transaction.from = f.owner.wallet!; f.receipt.blockNumber = 10n;
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, f.prep.operationId)).rejects.toThrow(/prepared/);
  });
  it.each(["vaultState", "reservePolicy", "balances", "payees", "budgets", "roles"])("reports changed %s without a preservation claim", async category => {
    const f = await fixture(); f.change(category);
    const result = await recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, f.prep.operationId);
    expect(result.stateMatch).toBe(false); expect(result.diffs).toContain(category);
  });
  it("pins mandatory reads to pre-upgrade and receipt blocks; a failed read never matches", async () => {
    const f = await fixture(); f.change();
    expect((await recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, f.prep.operationId)).stateMatch).toBe(true);
    const snapshots = f.readContract.mock.calls.map(([call]) => call).filter(c => ["balanceOf", "getReservePolicy", "getBudget"].includes(c.functionName));
    expect(new Set(snapshots.map(c => c.blockNumber))).toEqual(new Set([10n, 20n]));
    f.offline();
    await expect(recordUpgrade(db, f.client, deployment, f.owner, f.business.id, txHash, f.prep.operationId)).rejects.toThrow(/offline/);
  });
});
