import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment, symbolonVaultAbi } from "@symbolon/chain";
import { businesses, createTestDb, decisions, members, queuedChanges, users } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, getAddress, keccak256, type Hex, type PublicClient } from "viem";

const chainState = vi.hoisted(() => ({
  getVaultState: vi.fn(),
  queuedChangeEta: vi.fn(),
  getBudget: vi.fn(),
  getPayee: vi.fn(),
  reserveStatus: vi.fn(),
  getBlock: vi.fn(),
  getTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@symbolon/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@symbolon/chain")>()),
  symbolonContracts: () => ({
    lens: {
      read: {
        getVaultState: chainState.getVaultState,
        queuedChangeEta: chainState.queuedChangeEta,
        getBudget: chainState.getBudget,
        getPayee: chainState.getPayee,
        reserveStatus: chainState.reserveStatus,
      },
    },
  }),
}));

import {
  CHANGE_KINDS,
  GATED_FUNCTION_NAMES,
  getChangeKindByFunctionName,
  getChangeKindByKindName,
} from "@/lib/server/change-kinds";
import {
  isLooseningAddressRole,
  isLooseningAutoUpdate,
  isLooseningBudget,
  isLooseningPolicy,
  isLooseningReservePolicy,
  isLooseningRole,
  isLooseningSupportedToken,
  isLooseningTerms,
  isScreeningLooser,
} from "@/lib/server/loosening";
import {
  listQueuedChanges,
  prepareChange,
  recordChange,
} from "@/lib/server/queued-change";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(() => {
  chainState.getVaultState.mockReset();
  chainState.queuedChangeEta.mockReset();
  chainState.getBudget.mockReset();
  chainState.getPayee.mockReset();
  chainState.reserveStatus.mockReset();
  chainState.getBlock.mockReset();
  chainState.getTransactionReceipt.mockReset();
  chainState.getTransaction.mockReset();
});

const deployment = getDeployment(arcTestnet.id);
let walletNo = 1000;
const nextAddress = () => "0x" + (walletNo++).toString(16).padStart(40, "0");

async function fixture() {
  const ownerWallet = nextAddress();
  const approverWallet = nextAddress();
  const vaultAddress = nextAddress();

  const [owner] = await db
    .insert(users)
    .values({ email: "owner-" + crypto.randomUUID() + "@example.test", wallet: ownerWallet })
    .returning();
  const [approver] = await db
    .insert(users)
    .values({ email: "approver-" + crypto.randomUUID() + "@example.test", wallet: approverWallet })
    .returning();
  const [biz] = await db
    .insert(businesses)
    .values({ name: "Acme", chainId: arcTestnet.id, vault: vaultAddress })
    .returning();

  await db.insert(members).values([
    { businessId: biz!.id, userId: owner!.id, role: "owner" },
    { businessId: biz!.id, userId: approver!.id, role: "approver" },
  ]);

  return { owner: owner!, approver: approver!, biz: biz!, ownerWallet, vaultAddress };
}

describe("05t Part A: Loosening Rules Mirror (pure)", () => {
  it("evaluates isScreeningLooser correctly", () => {
    // 0 is "not required" -> loosest
    expect(isScreeningLooser(30n, 0n)).toBe(true);
    expect(isScreeningLooser(0n, 30n)).toBe(false); // requiring screening is tightening
    expect(isScreeningLooser(7n, 30n)).toBe(true); // longer maxAge is looser
    expect(isScreeningLooser(30n, 7n)).toBe(false); // shorter maxAge is tighter
    expect(isScreeningLooser(30n, 30n)).toBe(false);
  });

  it("evaluates isLooseningPolicy for cap increases, delay reductions, etc.", () => {
    const base = {
      perTxCap: 1000n,
      autoPayLimit: 500n,
      ownerThreshold: 2000n,
      newVendorMinPaid: 3,
      screeningMaxAge: 30n,
      newPayeeDelay: 86400n,
      changeCooldown: 86400n,
      looseningDelay: 86400n,
      maxBridgeFee: 10n,
    };

    expect(isLooseningPolicy(base, { ...base })).toBe(false);
    expect(isLooseningPolicy(base, { ...base, perTxCap: 2000n })).toBe(true);
    expect(isLooseningPolicy(base, { ...base, autoPayLimit: 600n })).toBe(true);
    expect(isLooseningPolicy(base, { ...base, ownerThreshold: 2500n })).toBe(true);
    expect(isLooseningPolicy(base, { ...base, newVendorMinPaid: 2 })).toBe(true); // lower paid count requirement is looser
    expect(isLooseningPolicy(base, { ...base, newPayeeDelay: 43200n })).toBe(true); // shorter delay is looser
    expect(isLooseningPolicy(base, { ...base, changeCooldown: 43200n })).toBe(true); // shorter cooldown is looser
    expect(isLooseningPolicy(base, { ...base, looseningDelay: 43200n })).toBe(true); // shorter loosening delay is looser
    expect(isLooseningPolicy(base, { ...base, maxBridgeFee: 20n })).toBe(true); // higher bridge fee is looser
    expect(isLooseningPolicy(base, { ...base, perTxCap: 500n })).toBe(false); // tighter
  });

  it("evaluates isLooseningBudget", () => {
    // Non-existent budget is never loosening
    expect(isLooseningBudget({ exists: false, cap: 0n, periodLength: 0n }, { cap: 1000n, periodLength: 86400n })).toBe(false);
    // Increasing cap or decreasing period length is loosening
    expect(isLooseningBudget({ exists: true, cap: 1000n, periodLength: 86400n }, { cap: 2000n, periodLength: 86400n })).toBe(true);
    expect(isLooseningBudget({ exists: true, cap: 1000n, periodLength: 86400n }, { cap: 1000n, periodLength: 43200n })).toBe(true);
    expect(isLooseningBudget({ exists: true, cap: 1000n, periodLength: 86400n }, { cap: 500n, periodLength: 86400n })).toBe(false);
  });

  it("evaluates isLooseningTerms", () => {
    const base = {
      budget: "0x1111111111111111111111111111111111111111111111111111111111111111",
      requirePo: true,
      requireDelivery: true,
      monthlyCap: 1000n,
    };
    expect(isLooseningTerms(base, { ...base })).toBe(false);
    expect(isLooseningTerms(base, { ...base, requirePo: false })).toBe(true);
    expect(isLooseningTerms(base, { ...base, requireDelivery: false })).toBe(true);
    expect(isLooseningTerms(base, { ...base, monthlyCap: 2000n })).toBe(true);
    expect(isLooseningTerms(base, { ...base, budget: "0x2222222222222222222222222222222222222222222222222222222222222222" })).toBe(true);
  });

  it("evaluates isLooseningRole, address roles, tokens, auto-update, and reserve", () => {
    expect(isLooseningRole("approver", true)).toBe(true);
    expect(isLooseningRole("approver", false)).toBe(false);
    expect(isLooseningRole("requester", true)).toBe(true);

    expect(isLooseningAddressRole("steward", "0x5555555555555555555555555555555555555555")).toBe(true);
    expect(isLooseningAddressRole("steward", "0x0000000000000000000000000000000000000000")).toBe(false);

    expect(isLooseningSupportedToken(true)).toBe(true);
    expect(isLooseningSupportedToken(false)).toBe(false);

    expect(isLooseningAutoUpdate(true)).toBe(true);
    expect(isLooseningAutoUpdate(false)).toBe(false);

    expect(isLooseningReservePolicy({ enabled: false, maxReserveBps: 0, minOperating: 0n }, { enabled: true, maxReserveBps: 2000, minOperating: 1000n })).toBe(true);
    expect(isLooseningReservePolicy({ enabled: true, maxReserveBps: 2000, minOperating: 1000n }, { enabled: true, maxReserveBps: 3000, minOperating: 1000n })).toBe(true);
    expect(isLooseningReservePolicy({ enabled: true, maxReserveBps: 2000, minOperating: 1000n }, { enabled: true, maxReserveBps: 2000, minOperating: 500n })).toBe(true);
    expect(isLooseningReservePolicy({ enabled: true, maxReserveBps: 2000, minOperating: 1000n }, { enabled: true, maxReserveBps: 1000, minOperating: 2000n })).toBe(false);
  });
});

describe("05t Part A: Change Kinds Registry (Q4)", () => {
  it("registers every gated function in SymbolonVault ABI and verifies applied events", () => {
    const abiFunctionNames = symbolonVaultAbi
      .filter((item) => item.type === "function")
      .map((f: any) => f.name);

    const abiEventNames = symbolonVaultAbi
      .filter((item) => item.type === "event")
      .map((e: any) => e.name);

    expect(GATED_FUNCTION_NAMES).toHaveLength(10);

    for (const fn of GATED_FUNCTION_NAMES) {
      expect(abiFunctionNames).toContain(fn);
      const def = CHANGE_KINDS[fn];
      expect(def).toBeDefined();
      expect(def.functionName).toBe(fn);
      expect(abiEventNames).toContain(def.appliedEvent);
    }
  });
});

describe("05t Part A: Queued Change Service (prepare & record)", () => {
  it("prepareChange: rejects non-owner with 403", async () => {
    const { approver, biz } = await fixture();
    const fakeClient = {} as unknown as PublicClient;

    await expect(
      prepareChange(db, fakeClient, deployment, approver, biz.id, {
        kind: "setAutoUpdate",
        args: [true],
      }),
    ).rejects.toThrow(AuthError);
  });

  it("prepareChange: returns apply-now when tightening or looseningDelay is 0", async () => {
    const { owner, biz, ownerWallet, vaultAddress } = await fixture();
    const fakeClient = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1000000n }),
    } as unknown as PublicClient;

    chainState.getVaultState.mockResolvedValue({
      owner: ownerWallet,
      policy: { looseningDelay: 0n },
    });
    chainState.queuedChangeEta.mockResolvedValue(0n);

    const res = await prepareChange(db, fakeClient, deployment, owner, biz.id, {
      kind: "setAutoUpdate",
      args: [true],
    });

    expect(res.ok).toBe(true);
    expect(res.state).toBe("apply-now");
    expect(res.to.toLowerCase()).toBe(vaultAddress.toLowerCase());
  });

  it("prepareChange: returns will-queue when loosening with non-zero delay and no queued eta", async () => {
    const { owner, biz, ownerWallet } = await fixture();
    const fakeClient = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1000000n }),
    } as unknown as PublicClient;

    chainState.getVaultState.mockResolvedValue({
      owner: ownerWallet,
      policy: { looseningDelay: 86400n },
    });
    chainState.queuedChangeEta.mockResolvedValue(0n);

    const res = await prepareChange(db, fakeClient, deployment, owner, biz.id, {
      kind: "setAutoUpdate",
      args: [true],
    });

    expect(res.ok).toBe(true);
    expect(res.state).toBe("will-queue");
    expect(res.eta).toBeDefined();
  });

  it("prepareChange: returns already-queued or ready depending on eta vs block time", async () => {
    const { owner, biz, ownerWallet } = await fixture();
    const fakeClient = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1000000n }),
    } as unknown as PublicClient;

    chainState.getVaultState.mockResolvedValue({
      owner: ownerWallet,
      policy: { looseningDelay: 86400n },
    });
    // Future eta
    chainState.queuedChangeEta.mockResolvedValue(1050000n);

    const futureRes = await prepareChange(db, fakeClient, deployment, owner, biz.id, {
      kind: "setAutoUpdate",
      args: [true],
    });
    expect(futureRes.state).toBe("already-queued");

    // Past eta (ready to apply!)
    chainState.queuedChangeEta.mockResolvedValue(999999n);

    const readyRes = await prepareChange(db, fakeClient, deployment, owner, biz.id, {
      kind: "setAutoUpdate",
      args: [true],
    });
    expect(readyRes.state).toBe("ready");
  });

  it("recordChange: records ChangeQueued and appends decision", async () => {
    const { owner, biz, vaultAddress } = await fixture();
    const txHash = ("0x" + "aa".repeat(32)) as Hex;
    const calldata = "0x" + "cc".repeat(20);
    const mockHash = keccak256(calldata as Hex);

    const fakeClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        to: vaultAddress,
        logs: [
          {
            address: vaultAddress,
            topics: encodeEventTopics({
              abi: symbolonVaultAbi,
              eventName: "ChangeQueued",
              args: { changeId: mockHash, selector: "0x12345678" },
            }),
            data: encodeAbiParameters([{ type: "uint64" }], [2000000n]),
          },
        ],
      }),
      getTransaction: vi.fn().mockResolvedValue({
        hash: txHash,
        input: calldata,
      }),
    } as unknown as PublicClient;

    const res = await recordChange(db, fakeClient, deployment, owner, biz.id, txHash);
    expect(res.ok).toBe(true);
    expect(res.status).toBe("queued");
    expect(res.changeId).toBe(mockHash.toLowerCase());

    const rows = await listQueuedChanges(db, biz.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.status).toBe("queued");
  });

  it("recordChange: records ChangeCancelled and updates status", async () => {
    const { owner, biz, vaultAddress } = await fixture();
    const changeId = ("0x" + "dd".repeat(32)) as Hex;

    await db.insert(queuedChanges).values({
      businessId: biz.id,
      kind: "set_auto_update",
      changeId: changeId.toLowerCase(),
      selector: "0x12345678",
      summary: {},
      eta: new Date(Date.now() + 86400000),
      status: "queued",
    });

    const txHash = ("0x" + "ee".repeat(32)) as Hex;
    const fakeClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        to: vaultAddress,
        logs: [
          {
            address: vaultAddress,
            topics: encodeEventTopics({
              abi: symbolonVaultAbi,
              eventName: "ChangeCancelled",
              args: { changeId: changeId },
            }),
            data: "0x",
          },
        ],
      }),
    } as unknown as PublicClient;

    const res = await recordChange(db, fakeClient, deployment, owner, biz.id, txHash);
    expect(res.ok).toBe(true);
    expect(res.status).toBe("cancelled");

    const [updated] = await db
      .select()
      .from(queuedChanges)
      .where(eq(queuedChanges.changeId, changeId.toLowerCase()));
    expect(updated!.status).toBe("cancelled");
  });
});

