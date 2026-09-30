import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, members, stewardRuns, users, type Database } from "@symbolon/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

// Mock Circle provision and client
const mockProvision = vi.fn();
vi.mock("@symbolon/steward", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@symbolon/steward")>();
  return {
    ...actual,
    createCircleClient: () => ({}),
    provisionStewardWallet: (...args: unknown[]) => mockProvision(...args),
  };
});

import { feeBalance, formatFeeBalance, MIN_STEWARD_FEE_BALANCE, resolveStewardWallet, runForBusiness, STEWARD_RUN_LEASE_MS, lastRun, listRunDecisions, type StewardConfig } from "@/lib/server/steward-runtime";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg: StewardConfig = {
  chainId: arcTestnet.id,
  deployment: getDeployment(arcTestnet.id),
  stewardCircle: { apiKey: "test-api-key", entitySecret: "test-entity-secret" },
};

const fresh = () => privateKeyToAccount(generatePrivateKey()).address;

async function setupBusiness(opts: { mode?: "shadow" | "assist" | "auto"; stewardWallet?: string; vault?: string } = {}) {
  const [u] = await db.insert(users).values({ wallet: fresh().toLowerCase() }).returning();
  const steward = opts.stewardWallet ?? fresh().toLowerCase();
  const vault = opts.vault ?? fresh().toLowerCase();
  const [b] = await db
    .insert(businesses)
    .values({
      name: "Acme Steward Test",
      chainId: cfg.chainId,
      vault,
      vaultBlock: 1000n,
      stewardWallet: steward,
      stewardMode: opts.mode ?? "shadow",
    })
    .returning();
  await db.insert(members).values({ businessId: b!.id, userId: u!.id, role: "owner" });
  return { user: u!, business: b!, steward, vault };
}

describe("feeBalance and formatFeeBalance", () => {
  it("formats null balance as can't confirm", () => {
    expect(formatFeeBalance(null)).toEqual({ formatted: "can't confirm", raw: null });
  });

  it("formats zero native USDC balance", () => {
    expect(formatFeeBalance(0n)).toEqual({ formatted: "0 USDC", raw: "0" });
  });

  it("formats 0.01 native USDC (18 decimals)", () => {
    expect(formatFeeBalance(10_000_000_000_000_000n)).toEqual({ formatted: "0.01 USDC", raw: "10000000000000000" });
  });

  it("reads fee balance using client.getBalance", async () => {
    const addr = fresh();
    const mockClient = {
      getBalance: vi.fn().mockResolvedValue(50_000_000_000_000_000n),
    } as unknown as PublicClient;

    const bal = await feeBalance(mockClient, addr);
    expect(bal).toBe(50_000_000_000_000_000n);
    expect(mockClient.getBalance).toHaveBeenCalledWith({ address: getAddress(addr) });
  });

  it("returns null on client.getBalance error", async () => {
    const mockClient = {
      getBalance: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    } as unknown as PublicClient;

    const bal = await feeBalance(mockClient, fresh());
    expect(bal).toBeNull();
  });
});

describe("resolveStewardWallet", () => {
  it("returns undefined when stewardCircle is not configured", async () => {
    const mockClient = {} as unknown as PublicClient;
    const wallet = await resolveStewardWallet(mockClient, { ...cfg, stewardCircle: null }, {
      id: "biz-1",
      vault: fresh(),
      stewardWallet: fresh(),
    });
    expect(wallet).toBeUndefined();
  });

  it("throws error if provisioned address does not match business record", async () => {
    const stewardA = fresh();
    const stewardB = fresh();
    mockProvision.mockResolvedValueOnce({ address: stewardA, walletId: "w-1" });

    const mockClient = {} as unknown as PublicClient;
    await expect(
      resolveStewardWallet(mockClient, cfg, { id: "biz-1", vault: fresh(), stewardWallet: stewardB }),
    ).rejects.toThrow("Steward wallet mismatch");
  });

  it("throws error if onchain steward does not match provisioned address", async () => {
    const steward = fresh();
    const otherSteward = fresh();
    mockProvision.mockResolvedValueOnce({ address: steward, walletId: "w-1" });

    const mockClient = {
      readContract: vi.fn().mockResolvedValue({ steward: otherSteward }),
    } as unknown as PublicClient;

    await expect(
      resolveStewardWallet(mockClient, cfg, { id: "biz-1", vault: fresh(), stewardWallet: steward }),
    ).rejects.toThrow("Vault onchain steward");
  });

  it("resolves and returns CircleStewardWallet when addresses match", async () => {
    const steward = fresh();
    mockProvision.mockResolvedValueOnce({ address: steward, walletId: "w-1" });

    const mockClient = {
      readContract: vi.fn().mockResolvedValue({ steward }),
    } as unknown as PublicClient;

    const wallet = await resolveStewardWallet(mockClient, cfg, { id: "biz-1", vault: fresh(), stewardWallet: steward });
    expect(wallet).toBeDefined();
    expect(wallet?.address.toLowerCase()).toBe(steward.toLowerCase());
  });
});

describe("runForBusiness", () => {
  it("short-circuits with skipped_paused when Vault is paused (S10)", async () => {
    const { business, user } = await setupBusiness();

    const mockClient = {
      readContract: vi.fn().mockImplementation(({ functionName }) => {
        if (functionName === "getVaultState") return { paused: true, steward: business.stewardWallet };
        throw new Error(`Unexpected function ${functionName}`);
      }),
    } as unknown as PublicClient;

    const run = await runForBusiness(db, mockClient, cfg, business.id, "manual", user.id);
    expect(run.status).toBe("skipped_paused");
    expect(run.summary).toEqual({ reason: "payments_paused" });
  });

  it("enforces run lease and rejects simultaneous concurrent runs (S6)", async () => {
    const { business, user } = await setupBusiness();

    // Insert an active running lease
    await db.insert(stewardRuns).values({
      businessId: business.id,
      trigger: "manual",
      mode: "shadow",
      status: "running",
      startedAt: new Date(),
    });

    const mockClient = {} as unknown as PublicClient;
    await expect(runForBusiness(db, mockClient, cfg, business.id, "manual", user.id)).rejects.toThrow(
      "A Steward run is already in progress.",
    );
  });

  it("recovers an expired running lease older than STEWARD_RUN_LEASE_MS (S6)", async () => {
    const { business, user } = await setupBusiness();

    // Insert a stale lease from 10 minutes ago
    const staleTime = new Date(Date.now() - (STEWARD_RUN_LEASE_MS + 60_000));
    const [stale] = await db.insert(stewardRuns).values({
      businessId: business.id,
      trigger: "manual",
      mode: "shadow",
      status: "running",
      startedAt: staleTime,
    }).returning();

    const mockClient = {
      readContract: vi.fn().mockImplementation(({ functionName }) => {
        if (functionName === "getVaultState") return { paused: true, steward: business.stewardWallet };
        throw new Error(`Unexpected function ${functionName}`);
      }),
    } as unknown as PublicClient;

    const run = await runForBusiness(db, mockClient, cfg, business.id, "manual", user.id);
    expect(run.status).toBe("skipped_paused");

    // The stale run should have been marked failed
    const [updatedStale] = await db.select().from(stewardRuns).where(eq(stewardRuns.id, stale!.id));
    expect(updatedStale?.status).toBe("failed");
    expect(updatedStale?.error).toBe("Previous lease expired");
  });

  it("skips auto mode runs when fee balance is below minimum threshold (S5)", async () => {
    const { business, user } = await setupBusiness({ mode: "auto" });

    const mockClient = {
      readContract: vi.fn().mockImplementation(({ functionName }) => {
        if (functionName === "getVaultState") return { paused: false, steward: business.stewardWallet };
        throw new Error(`Unexpected function ${functionName}`);
      }),
      getBalance: vi.fn().mockResolvedValue(5_000_000_000_000_000n), // 0.005 USDC < 0.01 threshold
    } as unknown as PublicClient;

    const run = await runForBusiness(db, mockClient, cfg, business.id, "manual", user.id);
    expect(run.status).toBe("skipped_fees");
    expect(run.error).toContain("fee balance is too low");
  });
});
