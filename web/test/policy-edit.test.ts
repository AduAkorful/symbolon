import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  members,
  users,
} from "@symbolon/db";
import { getAddress, type Hex, type PublicClient } from "viem";
import {
  loadPolicyView,
  preparePolicyChange,
  validatePolicySanity,
} from "@/lib/server/policy-edit";
import { AuthError } from "@/lib/server/errors";
import type { VaultPolicy } from "@symbolon/steward";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Hex;
const deployment = getDeployment(arcTestnet.id);
let userNo = 6000;
let vaultNo = 1000;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({
      email: `policy-owner-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [viewer] = await db
    .insert(users)
    .values({
      email: `policy-viewer-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [outsider] = await db
    .insert(users)
    .values({
      email: `policy-outsider-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const vault = address(++vaultNo);
  const [biz] = await db
    .insert(businesses)
    .values({
      name: "Acme Policy",
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

describe("validatePolicySanity", () => {
  it("detects sanity issues without blocking", () => {
    const policy: VaultPolicy = {
      perTxCap: 10_000_000_000n,
      ownerThreshold: 20_000_000_000n, // > perTxCap
      autoPayLimit: 25_000_000_000n, // > ownerThreshold
      newVendorMinPaid: 3,
      screeningMaxAge: 30n * 86_400n,
      newPayeeDelay: 86_400n,
      changeCooldown: 3600n, // < 24h
      looseningDelay: 0n, // immediate
      maxBridgeFee: 0n,
    };
    const warnings = validatePolicySanity(policy);
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain("Auto-pay limit exceeds");
    expect(warnings[1]).toContain("Owner threshold exceeds");
    expect(warnings[2]).toContain("Loosening delay is set to 0");
    expect(warnings[3]).toContain("Payout and Seal change cooldown is shorter than 24 hours");
  });
});

describe("policy-edit service", () => {
  const currentPolicyOnchain = {
    perTxCap: 50_000_000_000n,
    autoPayLimit: 2_500_000_000n,
    ownerThreshold: 10_000_000_000n,
    newVendorMinPaid: 3n,
    screeningMaxAge: 30n * 86_400n,
    newPayeeDelay: 86_400n,
    changeCooldown: 72n * 3600n,
    looseningDelay: 24n * 3600n,
    maxBridgeFee: 0n,
  };

  it("loadPolicyView returns policy, rules items, and warnings", async () => {
    const f = await fixture();

    const mockClient = {
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === "accountingDecimals") return 6;
        if (functionName === "queuedChangeEta") return 0n;
        if (functionName === "getPolicy") return currentPolicyOnchain;
        return null;
      }),
    } as unknown as PublicClient;

    const data = await loadPolicyView(db, mockClient, deployment, f.viewer, f.biz.id);
    expect(data.rules).toHaveLength(9);
    expect(data.policy.perTxCap).toBe("50000000000");
    expect(data.looseningDelaySeconds).toBe(86400);

    // Outsider is refused
    await expect(
      loadPolicyView(db, mockClient, deployment, f.outsider, f.biz.id),
    ).rejects.toThrow(AuthError);
  });

  it("preparePolicyChange refuses identical policy and non-owner", async () => {
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
            policy: currentPolicyOnchain,
          };
        }
        if (functionName === "getPolicy") return currentPolicyOnchain;
        return null;
      }),
    } as unknown as PublicClient;

    // Viewer is refused
    await expect(
      preparePolicyChange(db, mockClient, deployment, f.viewer, f.biz.id, {
        ...currentPolicyOnchain,
        perTxCap: 60_000_000_000n,
        newVendorMinPaid: 3,
      }),
    ).rejects.toThrow(AuthError);

    // Identical policy is refused
    await expect(
      preparePolicyChange(db, mockClient, deployment, f.owner, f.biz.id, {
        ...currentPolicyOnchain,
        newVendorMinPaid: 3,
      }),
    ).rejects.toThrow(AuthError);

    // Tightening change (lower perTxCap) succeeds and isLooser = false
    const tightening = await preparePolicyChange(
      db,
      mockClient,
      deployment,
      f.owner,
      f.biz.id,
      {
        ...currentPolicyOnchain,
        perTxCap: 40_000_000_000n,
        newVendorMinPaid: 3,
      },
    );
    expect(tightening.isLooser).toBe(false);
    expect(tightening.state).toBe("apply-now");

    // Loosening change (higher autoPayLimit) succeeds and isLooser = true
    const loosening = await preparePolicyChange(
      db,
      mockClient,
      deployment,
      f.owner,
      f.biz.id,
      {
        ...currentPolicyOnchain,
        autoPayLimit: 5_000_000_000n,
        newVendorMinPaid: 3,
      },
    );
    expect(loosening.isLooser).toBe(true);
    expect(loosening.state).toBe("will-queue");
  });
});
