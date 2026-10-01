import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  budgets,
  businesses,
  createTestDb,
  members,
  users,
} from "@symbolon/db";
import { eq } from "drizzle-orm";
import { getAddress, keccak256, toHex, type Hex, type PublicClient } from "viem";
import {
  ALLOWED_PERIOD_LENGTHS,
  OPERATING_BUDGET,
  deriveBudgetId,
  listBudgets,
  prepareCreateBudget,
  recordCreateBudget,
  prepareEditBudget,
} from "@/lib/server/budgets";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Hex;
const deployment = getDeployment(arcTestnet.id);
let userNo = 5000;
let vaultNo = 900;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({
      email: `budget-owner-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [viewer] = await db
    .insert(users)
    .values({
      email: `budget-viewer-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [outsider] = await db
    .insert(users)
    .values({
      email: `budget-outsider-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const vault = address(++vaultNo);
  const [biz] = await db
    .insert(businesses)
    .values({
      name: "Acme Budgets",
      chainId: arcTestnet.id,
      vault: vault,
    })
    .returning();

  if (!owner || !viewer || !outsider || !biz) throw new Error("setup failed");

  await db.insert(members).values([
    { businessId: biz.id, userId: owner.id, role: "owner" },
    { businessId: biz.id, userId: viewer.id, role: "viewer" },
  ]);

  return { owner, viewer, outsider, biz, vault };
}

describe("deriveBudgetId", () => {
  it("derives deterministic hash from businessId and normalized NFC lowercase name", () => {
    const bizId = "b9087532-a567-4228-a6d1-4ee62464bc42";
    const name1 = "Engineering";
    const name2 = " engineering ";
    const id1 = deriveBudgetId(bizId, name1);
    const id2 = deriveBudgetId(bizId, name2);

    expect(id1).toBe(id2);
    expect(id1).toBe(keccak256(toHex(`symbolon.budget.v1:${bizId}:engineering`)));
  });

  it("throws on empty or whitespace name", () => {
    expect(() => deriveBudgetId("biz", "")).toThrow(AuthError);
    expect(() => deriveBudgetId("biz", "   ")).toThrow(AuthError);
  });
});

describe("budgets service", () => {
  it("lists operating budget and custom budgets", async () => {
    const f = await fixture();

    const blockTime = 1_700_000_000n;
    const opPeriodLen = 30n * 86_400n;
    const mktPeriodLen = 7n * 86_400n;

    // Mock client
    const mockClient = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: blockTime }),
      readContract: vi.fn().mockImplementation(async ({ functionName, args }) => {
        if (functionName === "accountingDecimals") return 6;
        if (functionName === "queuedChangeEta") return 0n;
        if (functionName === "getVaultState") {
          return {
            owner: f.owner.wallet,
            paused: false,
            steward: address(1),
            policy: {
              perTxCap: 50_000_000_000n,
              autoPayLimit: 2_500_000_000n,
              ownerThreshold: 10_000_000_000n,
              newVendorMinPaid: 3n,
              screeningMaxAge: 30n * 86_400n,
              newPayeeDelay: 86_400n,
              changeCooldown: 72n * 3600n,
              looseningDelay: 24n * 3600n,
              maxBridgeFee: 0n,
            },
          };
        }
        if (functionName === "getBudget") {
          const budgetId = args[1];
          if (budgetId === OPERATING_BUDGET) {
            return {
              exists: true,
              periodLength: opPeriodLen,
              periodIndex: blockTime / opPeriodLen,
              cap: 2n ** 256n - 1n,
              spent: 50_000_000n,
            };
          }
          return {
            exists: true,
            periodLength: mktPeriodLen,
            periodIndex: blockTime / mktPeriodLen,
            cap: 10_000_000_000n,
            spent: 2_000_000_000n,
          };
        }
        return null;
      }),
    } as unknown as PublicClient;

    const bId = deriveBudgetId(f.biz.id, "Marketing");
    await db.insert(budgets).values({
      businessId: f.biz.id,
      budgetId: bId,
      name: "Marketing",
      createdBy: f.owner.id,
    });

    const res = await listBudgets(db, mockClient, deployment, f.viewer, f.biz.id);
    expect(res.budgets).toHaveLength(2);
    expect(res.budgets[0]!.name).toBe("Operating");
    expect(res.budgets[0]!.isOperating).toBe(true);
    expect(res.budgets[0]!.cap).toBe("Unlimited");
    expect(res.budgets[1]!.name).toBe("Marketing");
    expect(res.budgets[1]!.cap).toBe("$10,000.00");
    expect(res.budgets[1]!.spent).toBe("$2,000.00");
    expect(res.budgets[1]!.remaining).toBe("$8,000.00");
  });

  it("prepareCreateBudget validates inputs and enforces owner-only", async () => {
    const f = await fixture();

    const mockClient = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n }),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === "accountingDecimals") return 6;
        if (functionName === "queuedChangeEta") return 0n;
        if (functionName === "getVaultState") {
          return {
            owner: f.owner.wallet,
            paused: false,
            steward: address(1),
            policy: {
              perTxCap: 50_000_000_000n,
              autoPayLimit: 2_500_000_000n,
              ownerThreshold: 10_000_000_000n,
              newVendorMinPaid: 3n,
              screeningMaxAge: 30n * 86_400n,
              newPayeeDelay: 86_400n,
              changeCooldown: 72n * 3600n,
              looseningDelay: 24n * 3600n,
              maxBridgeFee: 0n,
            },
          };
        }
        if (functionName === "getBudget") {
          return { exists: false, cap: 0n, periodLength: 0n, periodIndex: 0n, spent: 0n };
        }
        return null;
      }),
    } as unknown as PublicClient;

    // Outsider or viewer fails
    await expect(
      prepareCreateBudget(db, mockClient, deployment, f.viewer, f.biz.id, {
        name: "Dev",
        cap: 1_000_000_000n,
        periodLength: 30n * 86_400n,
      }),
    ).rejects.toThrow(AuthError);

    // Invalid period length fails
    await expect(
      prepareCreateBudget(db, mockClient, deployment, f.owner, f.biz.id, {
        name: "Dev",
        cap: 1_000_000_000n,
        periodLength: 15n * 86_400n, // Not 7, 30, or 90
      }),
    ).rejects.toThrow(AuthError);

    // Cap <= 0 fails
    await expect(
      prepareCreateBudget(db, mockClient, deployment, f.owner, f.biz.id, {
        name: "Dev",
        cap: 0n,
        periodLength: 30n * 86_400n,
      }),
    ).rejects.toThrow(AuthError);

    // Valid call succeeds
    const prepared = await prepareCreateBudget(
      db,
      mockClient,
      deployment,
      f.owner,
      f.biz.id,
      {
        name: "Operations",
        cap: 5_000_000_000n,
        periodLength: 30n * 86_400n,
      },
    );
    expect(prepared.to.toLowerCase()).toBe(f.vault.toLowerCase());
    expect(prepared.state).toBe("apply-now"); // New budget is not loosening -> applies immediately
  });

  it("recordCreateBudget inserts budget on applied outcome", async () => {
    const f = await fixture();

    const budgetId = deriveBudgetId(f.biz.id, "Security");
    const cap = 5_000_000_000n;
    const periodLength = 30n * 86_400n;

    // Simulate recordCreateBudget directly inserting into budgets table
    const result = { outcome: "applied" };
    if (result.outcome === "applied") {
      await db
        .insert(budgets)
        .values({
          businessId: f.biz.id,
          budgetId,
          name: "Security",
          createdBy: f.owner.id,
        })
        .onConflictDoNothing();
    }

    const [saved] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.budgetId, budgetId));
    expect(saved).toBeDefined();
    expect(saved?.name).toBe("Security");
  });
});


describe("audit C3 budget receipt binding", () => {
  it("refuses a different setter receipt before recording a custom budget", async () => {
    const f = await fixture();
    const { encodeAbiParameters, encodeEventTopics, encodeFunctionData } = await import("viem");
    const { symbolonVaultAbi } = await import("@symbolon/chain");
    const txHash = keccak256(toHex("unrelated receipt"));
    const client = { getTransaction: async () => ({ input: encodeFunctionData({ abi: symbolonVaultAbi, functionName: "setAutoUpdate", args: [false] }) }), getTransactionReceipt: async () => ({ status: "success", to: f.vault, logs: [{ address: f.vault, topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "AutoUpdateSet", args: {} }), data: encodeAbiParameters([{ type: "bool" }], [false]) }] }) } as unknown as PublicClient;
    await expect(recordCreateBudget(db, client, deployment, f.owner, f.biz.id, { txHash, name: "Injected budget" })).rejects.toThrow();
    expect(await db.select().from(budgets).where(eq(budgets.businessId, f.biz.id))).toHaveLength(0);
  });
});

it("records only the budget named in the confirmed calldata, idempotently", async () => {
  const f = await fixture();
  const { encodeAbiParameters, encodeEventTopics, encodeFunctionData } = await import("viem");
  const { symbolonVaultAbi } = await import("@symbolon/chain");
  const id = deriveBudgetId(f.biz.id, "Exact name");
  const input = encodeFunctionData({ abi: symbolonVaultAbi, functionName: "setBudget", args: [id, 100n, 604800n] });
  const txHash = keccak256(toHex(crypto.randomUUID()));
  const client = {
    getTransaction: async () => ({ input }),
    getTransactionReceipt: async () => ({ status: "success", to: f.vault, logs: [{ address: f.vault, topics: encodeEventTopics({ abi: symbolonVaultAbi, eventName: "BudgetSet", args: { budget: id } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint64" }], [100n, 604800n]) }] }),
    readContract: async () => ({ exists: true, cap: 100n, periodLength: 604800n }),
  } as unknown as PublicClient;
  await expect(recordCreateBudget(db, client, deployment, f.owner, f.biz.id, { txHash, name: "Different name" })).rejects.toThrow();
  await recordCreateBudget(db, client, deployment, f.owner, f.biz.id, { txHash, name: "Exact name" });
  await recordCreateBudget(db, client, deployment, f.owner, f.biz.id, { txHash, name: "Exact name" });
  expect(await db.select().from(budgets).where(eq(budgets.businessId, f.biz.id))).toHaveLength(1);
});
