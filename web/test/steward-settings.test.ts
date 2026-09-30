import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAddress, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, decisions, members, users, type Database } from "@symbolon/db";
import { and, eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

// Mock Circle provision
const mockProvision = vi.fn();
vi.mock("@symbolon/steward", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@symbolon/steward")>();
  return {
    ...actual,
    createCircleClient: () => ({}),
    provisionStewardWallet: (...args: unknown[]) => mockProvision(...args),
  };
});

import { readSettings, setMode } from "@/lib/server/steward-settings";
import { MIN_STEWARD_FEE_BALANCE, type StewardConfig } from "@/lib/server/steward-runtime";
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

async function setupBusiness(role: "owner" | "approver" | "viewer" = "owner", mode: "shadow" | "assist" | "auto" = "shadow") {
  const [u] = await db.insert(users).values({ wallet: fresh().toLowerCase() }).returning();
  const steward = fresh().toLowerCase();
  const vault = fresh().toLowerCase();
  const [b] = await db
    .insert(businesses)
    .values({
      name: "Acme Mode Test",
      chainId: cfg.chainId,
      vault,
      stewardWallet: steward,
      stewardMode: mode,
    })
    .returning();
  await db.insert(members).values({ businessId: b!.id, userId: u!.id, role });
  return { user: u!, business: b!, steward, vault };
}

describe("steward-settings", () => {
  it("readSettings returns business steward settings", async () => {
    const { business } = await setupBusiness();
    const res = await readSettings(db, business.id);
    expect(res.mode).toBe("shadow");
    expect(res.stewardWallet).toBe(business.stewardWallet);
    expect(res.vault).toBe(business.vault);
  });

  it("non-owner cannot change mode (403)", async () => {
    const { business, user } = await setupBusiness("approver");
    const mockClient = {} as unknown as PublicClient;

    await expect(setMode(db, mockClient, cfg, user, business.id, "assist")).rejects.toThrow(
      "You don't have access to do this for this business.",
    );
  });

  it("rejects invalid mode with 400", async () => {
    const { business, user } = await setupBusiness("owner");
    const mockClient = {} as unknown as PublicClient;

    await expect(setMode(db, mockClient, cfg, user, business.id, "invalid_mode")).rejects.toThrow(
      "Mode must be shadow, assist, or auto.",
    );
  });

  it("switches from shadow to assist and writes decision record (S1)", async () => {
    const { business, user } = await setupBusiness("owner", "shadow");
    const mockClient = {} as unknown as PublicClient;

    const res = await setMode(db, mockClient, cfg, user, business.id, "assist");
    expect(res).toEqual({ ok: true, mode: "assist" });

    // Verify DB updated
    const [updated] = await db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(updated?.stewardMode).toBe("assist");

    // Verify decision recorded
    const [dec] = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.businessId, business.id), eq(decisions.kind, "steward_mode_changed")));
    expect(dec).toBeDefined();
    expect((dec?.record as Record<string, unknown>).inputs).toMatchObject({
      from: "shadow",
      to: "assist",
    });
  });

  it("requires policy confirmation when switching to auto mode (S1)", async () => {
    const { business, user } = await setupBusiness("owner", "shadow");
    const mockClient = {} as unknown as PublicClient;

    await expect(setMode(db, mockClient, cfg, user, business.id, "auto", false)).rejects.toThrow(
      "You must confirm the Vault's live policy limits",
    );
  });

  it("refuses auto mode if Circle is not configured (S1)", async () => {
    const { business, user } = await setupBusiness("owner", "shadow");
    const mockClient = {} as unknown as PublicClient;

    await expect(
      setMode(db, mockClient, { ...cfg, stewardCircle: null }, user, business.id, "auto", true),
    ).rejects.toThrow("Circle wallet integration is not configured");
  });

  it("refuses auto mode if onchain standing is not active or paused (S1)", async () => {
    const { business, user } = await setupBusiness("owner", "shadow");
    const otherSteward = fresh();

    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(12345n),
      readContract: vi.fn().mockImplementation(({ functionName }) => {
        if (functionName === "getVaultState") {
          // Reports a different steward onchain -> mismatch
          return { paused: false, steward: otherSteward };
        }
        throw new Error(`Unexpected function ${functionName}`);
      }),
    } as unknown as PublicClient;

    await expect(setMode(db, mockClient, cfg, user, business.id, "auto", true)).rejects.toThrow(
      "The Steward's onchain standing is mismatch",
    );
  });

  it("refuses auto mode if fee balance is below 0.01 USDC (S1, S5)", async () => {
    const { business, user } = await setupBusiness("owner", "shadow");

    mockProvision.mockResolvedValueOnce({ address: business.stewardWallet, walletId: "w-1" });

    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(12345n),
      readContract: vi.fn().mockImplementation(({ functionName }) => {
        if (functionName === "getVaultState") {
          return { paused: false, steward: business.stewardWallet };
        }
        throw new Error(`Unexpected function ${functionName}`);
      }),
      getBalance: vi.fn().mockResolvedValue(0n), // 0 USDC balance
    } as unknown as PublicClient;

    await expect(setMode(db, mockClient, cfg, user, business.id, "auto", true)).rejects.toThrow(
      "The Steward wallet must have at least 0.01 USDC for network fees",
    );
  });

  it("switches to auto mode when all prerequisites are met (S1)", async () => {
    const { business, user } = await setupBusiness("owner", "shadow");

    mockProvision.mockResolvedValueOnce({ address: business.stewardWallet, walletId: "w-1" });

    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(12345n),
      readContract: vi.fn().mockImplementation(({ functionName }) => {
        if (functionName === "getVaultState") {
          return { paused: false, steward: business.stewardWallet };
        }
        throw new Error(`Unexpected function ${functionName}`);
      }),
      getBalance: vi.fn().mockResolvedValue(MIN_STEWARD_FEE_BALANCE + 1000n),
    } as unknown as PublicClient;

    const res = await setMode(db, mockClient, cfg, user, business.id, "auto", true);
    expect(res).toEqual({ ok: true, mode: "auto" });

    const [updated] = await db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(updated?.stewardMode).toBe("auto");
  });
});
