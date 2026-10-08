import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { arcTestnet, getDeployment } from "@symbolon/chain";
import {
  businesses,
  createTestDb,
  decisions,
  members,
  users,
} from "@symbolon/db";
import { eq } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, type Hex, type PublicClient } from "viem";
import { symbolonVaultAbi } from "@symbolon/chain";
import {
  checkReleaseNudge,
  clearReleaseNudge,
  menuReleaseNudge,
  NUDGE_TTL_MS,
  compareVaultSnapshots,
  getEip1967ImplementationSlot,
  loadReleaseInfo,
  prepareCancelUpgrade,
  prepareScheduleUpgrade,
  prepareUpgrade,
  readCurrentImplementation,
  recordCancelUpgrade,
  recordScheduleUpgrade,
  recordUpgrade,
  type VaultStateSnapshot,
} from "@/lib/server/release";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Hex;
const deployment = getDeployment(arcTestnet.id);
let userNo = 8000;
let vaultNo = 3000;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({
      email: `release-owner-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [viewer] = await db
    .insert(users)
    .values({
      email: `release-viewer-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [outsider] = await db
    .insert(users)
    .values({
      email: `release-outsider-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const vault = address(++vaultNo);
  const [biz] = await db
    .insert(businesses)
    .values({
      name: "Acme Release",
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

describe("release mechanics and slots", () => {
  it("getEip1967ImplementationSlot matches OZ standard slot", () => {
    const slot = getEip1967ImplementationSlot();
    expect(slot.toLowerCase()).toBe(
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    );
  });

  it("readCurrentImplementation extracts address from storage slot", async () => {
    const impl = "0x02bCb1288338d47e31342737772D0b32bBA3842A";
    const padded = "0x" + "0".repeat(24) + impl.slice(2).toLowerCase();

    const mockClient = {
      getStorageAt: vi.fn().mockResolvedValue(padded),
    } as unknown as PublicClient;

    const res = await readCurrentImplementation(mockClient, address(1));
    expect(res).toBe(getAddress(impl));

    // Zero address storage
    const emptyClient = {
      getStorageAt: vi.fn().mockResolvedValue("0x" + "0".repeat(64)),
    } as unknown as PublicClient;
    expect(await readCurrentImplementation(emptyClient, address(1))).toBeNull();
  });
});

describe("loadReleaseInfo & checkReleaseNudge", () => {
  const v1Impl = "0x02bCb1288338d47e31342737772D0b32bBA3842A";
  const v2Impl = "0xA6aA3c4DB43f36b061939feF1f822E14bF06BcF8";

  it("identifies up-to-date state", async () => {
    const mockClient = {
      getStorageAt: vi.fn().mockResolvedValue("0x" + "0".repeat(24) + v2Impl.slice(2)),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n }),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === "latest") return [v2Impl, 2n];
        if (functionName === "getPolicy") return { looseningDelay: 86400n };
        if (functionName === "release") {
          return {
            version: 2n,
            publishedAt: 1_690_000_000n,
            revoked: false,
            notesHash: "0x13aa885b211d3b20ec6d0020340bf0d830c664e6a104dc0dbb04ba72fa1cb775",
          };
        }
        if (functionName === "scheduledUpgrade") return 0n;
        return null;
      }),
    } as unknown as PublicClient;

    const info = await loadReleaseInfo(mockClient, deployment, address(1));
    expect(info.state).toBe("up-to-date");
    expect(info.latest.notesVerified).toBe(true);

    const nudge = await checkReleaseNudge(mockClient, deployment, address(1));
    expect(nudge.hasNudge).toBe(false);
  });

  it("identifies available release state and nudge", async () => {
    const mockClient = {
      getStorageAt: vi.fn().mockResolvedValue("0x" + "0".repeat(24) + v1Impl.slice(2)),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n }),
      readContract: vi.fn().mockImplementation(async ({ functionName, args }) => {
        if (functionName === "latest") return [v2Impl, 2n];
        if (functionName === "getPolicy") return { looseningDelay: 86400n };
        if (functionName === "release") {
          if (args?.[0]?.toLowerCase() === v1Impl.toLowerCase()) {
            return {
              version: 1n,
              publishedAt: 1_680_000_000n,
              revoked: false,
              notesHash: "0xc3446a0b10279f3ab60cfb7cf1d7bafd400fcd03ba15f026f9ea91e8a0e8a909",
            };
          }
          return {
            version: 2n,
            publishedAt: 1_690_000_000n,
            revoked: false,
            notesHash: "0x13aa885b211d3b20ec6d0020340bf0d830c664e6a104dc0dbb04ba72fa1cb775",
          };
        }
        if (functionName === "scheduledUpgrade") return 0n;
        return null;
      }),
    } as unknown as PublicClient;

    const info = await loadReleaseInfo(mockClient, deployment, address(1));
    expect(info.state).toBe("available");

    const nudge = await checkReleaseNudge(mockClient, deployment, address(1));
    expect(nudge.hasNudge).toBe(true);
    expect(nudge.latestVersion).toBe(2);
    expect(nudge.currentVersion).toBe(1);
  });

  it("identifies scheduled and ready states", async () => {
    // Scheduled (delay not elapsed)
    const scheduledClient = {
      getStorageAt: vi.fn().mockResolvedValue("0x" + "0".repeat(24) + v1Impl.slice(2)),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n }),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === "latest") return [v2Impl, 2n];
        if (functionName === "getPolicy") return { looseningDelay: 86400n };
        if (functionName === "release") {
          return {
            version: 2n,
            publishedAt: 1_690_000_000n,
            revoked: false,
            notesHash: "0x13aa885b211d3b20ec6d0020340bf0d830c664e6a104dc0dbb04ba72fa1cb775",
          };
        }
        if (functionName === "scheduledUpgrade") return 1_700_050_000n; // future
        return null;
      }),
    } as unknown as PublicClient;

    const schedInfo = await loadReleaseInfo(scheduledClient, deployment, address(1));
    expect(schedInfo.state).toBe("scheduled");

    // Ready (delay elapsed)
    const readyClient = {
      getStorageAt: vi.fn().mockResolvedValue("0x" + "0".repeat(24) + v1Impl.slice(2)),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_100_000n }),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === "latest") return [v2Impl, 2n];
        if (functionName === "getPolicy") return { looseningDelay: 86400n };
        if (functionName === "release") {
          return {
            version: 2n,
            publishedAt: 1_690_000_000n,
            revoked: false,
            notesHash: "0x13aa885b211d3b20ec6d0020340bf0d830c664e6a104dc0dbb04ba72fa1cb775",
          };
        }
        if (functionName === "scheduledUpgrade") return 1_700_050_000n; // past
        return null;
      }),
    } as unknown as PublicClient;

    const readyInfo = await loadReleaseInfo(readyClient, deployment, address(1));
    expect(readyInfo.state).toBe("ready");
  });
});

describe("snapshot comparison", () => {
  const baseSnapshot: VaultStateSnapshot = {
    owner: address(10),
    pendingOwner: address(0),
    steward: address(20),
    screener: address(0),
    paused: false,
    accountingDecimals: 6,
    autoUpdate: false,
    policy: {
      perTxCap: "1000",
      autoPayLimit: "500",
      ownerThreshold: "1000",
      newVendorMinPaid: 3,
      screeningMaxAge: "0",
      newPayeeDelay: "0",
      changeCooldown: "0",
      looseningDelay: "86400",
      maxBridgeFee: "0",
    },
  };

  it("detects equal snapshots", () => {
    const res = compareVaultSnapshots(baseSnapshot, { ...baseSnapshot });
    expect(res.match).toBe(true);
    expect(res.diffs).toHaveLength(0);
  });

  it("compares pending owner and screener", () => {
    const res = compareVaultSnapshots(baseSnapshot, { ...baseSnapshot, pendingOwner: address(50), screener: address(51) });
    expect(res.match).toBe(false); expect(res.diffs).toHaveLength(2);
  });

  it("detects field differences", () => {
    const altered: VaultStateSnapshot = {
      ...baseSnapshot,
      owner: address(11),
      policy: {
        ...baseSnapshot.policy,
        perTxCap: "2000",
      },
    };
    const res = compareVaultSnapshots(baseSnapshot, altered);
    expect(res.match).toBe(false);
    expect(res.diffs.length).toBe(2);
    expect(res.diffs[0]).toContain("owner");
    expect(res.diffs[1]).toContain("policy.perTxCap");
  });
});

describe("upgrade preparation and recording", () => {
  const v1Impl = "0x02bCb1288338d47e31342737772D0b32bBA3842A";
  const v2Impl = "0xA6aA3c4DB43f36b061939feF1f822E14bF06BcF8";

  it("schedule upgrade lifecycle: prepare and record", async () => {
    const f = await fixture();

    const mockClient = {
      getStorageAt: vi.fn().mockResolvedValue("0x" + "0".repeat(24) + v1Impl.slice(2)),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n }),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === "latest") return [v2Impl, 2n];
        if (functionName === "release") {
          return {
            version: 2n,
            publishedAt: 1_690_000_000n,
            revoked: false,
            notesHash: "0x13aa885b211d3b20ec6d0020340bf0d830c664e6a104dc0dbb04ba72fa1cb775",
          };
        }
        if (functionName === "getVaultState") {
          return {
            owner: f.owner.wallet,
            pendingOwner: address(0),
            steward: address(99),
            screener: address(0),
            paused: false,
            accountingDecimals: 6,
            autoUpdate: false,
            policy: {
              perTxCap: 1000n,
              autoPayLimit: 500n,
              ownerThreshold: 1000n,
              newVendorMinPaid: 3n,
              screeningMaxAge: 0n,
              newPayeeDelay: 0n,
              changeCooldown: 0n,
              looseningDelay: 86400n,
              maxBridgeFee: 0n,
            },
          };
        }
        return null;
      }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        to: f.vault,
        from: f.owner.wallet,
        logs: [
          {
            address: f.vault,
            topics: encodeEventTopics({
              abi: symbolonVaultAbi,
              eventName: "UpgradeScheduled",
              args: { implementation: getAddress(v2Impl) },
            }),
            data: encodeAbiParameters([{ type: "uint64" }], [1_700_086_400n]),
          },
        ],
      }),

    } as unknown as PublicClient;

    // Viewer refused
    await expect(
      prepareScheduleUpgrade(db, mockClient, deployment, f.viewer, f.biz.id),
    ).rejects.toThrow(AuthError);

    // Owner prepares
    const prep = await prepareScheduleUpgrade(db, mockClient, deployment, f.owner, f.biz.id);
    expect(prep.to).toBe(getAddress(f.vault));
    expect(prep.latestImpl).toBe(getAddress(v2Impl));
    expect(prep.stateSnapshot).toBeDefined();

    // Owner records
    const rec = await recordScheduleUpgrade(
      db,
      mockClient,
      deployment,
      f.owner,
      f.biz.id,
      "0x1234567890123456789012345678901234567890123456789012345678901234",
    );
    expect(rec.ok).toBe(true);
    expect(rec.implementation).toBe(getAddress(v2Impl));

    const decisionList = await db
      .select()
      .from(decisions)
      .where(eq(decisions.businessId, f.biz.id));
    const schedDecision = decisionList.find((d) => d.kind === "upgrade_scheduled");
    expect(schedDecision).toBeDefined();
  });

  it("cancel upgrade lifecycle: prepare and record", async () => {
    const f = await fixture();

    const mockClient = {
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === "latest") return [v2Impl, 2n];
        if (functionName === "getVaultState") {
          return {
            owner: f.owner.wallet,
            pendingOwner: address(0),
            steward: address(99),
            screener: address(0),
            paused: false,
            accountingDecimals: 6,
            autoUpdate: false,
            policy: {
              perTxCap: 1000n,
              autoPayLimit: 500n,
              ownerThreshold: 1000n,
              newVendorMinPaid: 3n,
              screeningMaxAge: 0n,
              newPayeeDelay: 0n,
              changeCooldown: 0n,
              looseningDelay: 86400n,
              maxBridgeFee: 0n,
            },
          };
        }
        if (functionName === "scheduledUpgrade") return 1_700_086_400n;
        return null;
      }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        to: f.vault,
        from: f.owner.wallet,
        logs: [
          {
            address: f.vault,
            topics: encodeEventTopics({
              abi: symbolonVaultAbi,
              eventName: "UpgradeCancelled",
              args: { implementation: getAddress(v2Impl) },
            }),
            data: "0x",
          },
        ],
      }),
    } as unknown as PublicClient;

    const prep = await prepareCancelUpgrade(db, mockClient, deployment, f.owner, f.biz.id);
    expect(prep.to).toBe(getAddress(f.vault));
    expect(prep.implementation).toBe(getAddress(v2Impl));

    const rec = await recordCancelUpgrade(
      db,
      mockClient,
      deployment,
      f.owner,
      f.biz.id,
      "0x1234567890123456789012345678901234567890123456789012345678901234",
    );
    expect(rec.ok).toBe(true);
    expect(rec.implementation).toBe(getAddress(v2Impl));

    const decisionList = await db
      .select()
      .from(decisions)
      .where(eq(decisions.businessId, f.biz.id));
    const cancelDecision = decisionList.find((d) => d.kind === "upgrade_cancelled");
    expect(cancelDecision).toBeDefined();
  });

  it("apply upgrade lifecycle: prepare and record with state diff verification", async () => {
    const f = await fixture();

    const vaultState = {
      owner: f.owner.wallet,
      pendingOwner: address(0),
      steward: address(99),
      screener: address(0),
      paused: false,
      accountingDecimals: 6,
      autoUpdate: false,
      policy: {
        perTxCap: 1000n,
        autoPayLimit: 500n,
        ownerThreshold: 1000n,
        newVendorMinPaid: 3n,
        screeningMaxAge: 0n,
        newPayeeDelay: 0n,
        changeCooldown: 0n,
        looseningDelay: 86400n,
        maxBridgeFee: 0n,
      },
    };

    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getTransaction: vi.fn().mockResolvedValue({ to: f.vault, from: f.owner.wallet, input: encodeFunctionData({ abi: symbolonVaultAbi, functionName: "upgradeToAndCall", args: [getAddress(v2Impl), "0x"] }) }),
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_100_000n }),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === "getReservePolicy") return { enabled: false, maxReserveBps: 0, minOperating: 0n };
        if (functionName === "balanceOf" || functionName === "approverBudgetCount") return 0n;
        if (["isSupportedToken", "isApprover", "isRequester"].includes(functionName)) return false;
        if (functionName === "getBudget") return { exists: true, cap: 100n, spent: 0n, periodLength: 30n, periodIndex: 1n };
        if (functionName === "latest") return [v2Impl, 2n];
        if (functionName === "release") return { revoked: false, publishedAt: 1n };
        if (functionName === "getVaultState") return vaultState;
        if (functionName === "scheduledUpgrade") return 1_700_050_000n; // ready
        return null;
      }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        blockNumber: 200n,
        status: "success",
        to: f.vault,
        from: f.owner.wallet,
        logs: [
          {
            address: f.vault,
            topics: encodeEventTopics({
              abi: symbolonVaultAbi,
              eventName: "Upgraded",
              args: { implementation: getAddress(v2Impl) },
            }),
            data: "0x",
          },
        ],
      }),
    } as unknown as PublicClient;

    const prep = await prepareUpgrade(db, mockClient, deployment, f.owner, f.biz.id);
    expect(prep.to).toBe(getAddress(f.vault));
    expect(prep.latestImpl).toBe(getAddress(v2Impl));
    expect(prep.stateSnapshotBefore).toBeDefined();

    await expect(recordUpgrade(db, mockClient, deployment, f.owner, f.biz.id, "0x1234567890123456789012345678901234567890123456789012345678901234")).rejects.toThrow(/snapshot is missing/);
    await expect(recordUpgrade(db, mockClient, deployment, f.owner, f.biz.id, "0x1234567890123456789012345678901234567890123456789012345678901234", crypto.randomUUID())).rejects.toThrow(/snapshot is missing/);
    await expect(recordUpgrade(db, mockClient, deployment, f.viewer, f.biz.id, "0x1234567890123456789012345678901234567890123456789012345678901234", prep.operationId)).rejects.toThrow(AuthError);
    const rec = await recordUpgrade(
      db,
      mockClient,
      deployment,
      f.owner,
      f.biz.id,
      "0x1234567890123456789012345678901234567890123456789012345678901234",
      prep.operationId,
    );
    expect(rec.ok).toBe(true);
    expect(rec.stateMatch).toBe(true);
    expect(rec.diffs).toHaveLength(0);
    expect(rec.implementation).toBe(getAddress(v2Impl));

    const decisionList = await db
      .select()
      .from(decisions)
      .where(eq(decisions.businessId, f.biz.id));
    const appliedDecision = decisionList.find((d) => d.kind === "upgrade_applied");
    expect(appliedDecision).toBeDefined();
    const decRec = appliedDecision?.record as Record<string, unknown>;
    expect(decRec.outcome).toBe("applied");
    vaultState.pendingOwner = address(987);
    const changed = await recordUpgrade(db, mockClient, deployment, f.owner, f.biz.id, "0x1234567890123456789012345678901234567890123456789012345678901234", prep.operationId);
    expect(changed.stateMatch).toBe(false); expect(changed.diffs).toContain("vaultState");
    const calls = (mockClient.readContract as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.filter(c => c.functionName === "balanceOf").every(c => c.blockNumber === 100n || c.blockNumber === 200n)).toBe(true);
  });
});

describe("menuReleaseNudge (plan 05zd F3)", () => {
  const v1Impl = "0x02bCb1288338d47e31342737772D0b32bBA3842A";
  const v2Impl = "0xA6aA3c4DB43f36b061939feF1f822E14bF06BcF8";
  const rel = (version: bigint) => ({ version, publishedAt: 1n, revoked: false, notesHash: "0x" + "00".repeat(32) });
  const clientFor = (current: string, failing = false) => {
    const reads = { count: 0 };
    const client = {
      getStorageAt: vi.fn().mockImplementation(async () => { reads.count++; if (failing) throw new Error("down"); return "0x" + "0".repeat(24) + current.slice(2); }),
      readContract: vi.fn().mockImplementation(async ({ functionName, args }) => {
        if (functionName === "latest") return [v2Impl, 2n];
        if (functionName === "release") return args?.[0]?.toLowerCase() === v1Impl.toLowerCase() ? rel(1n) : rel(2n);
        return null;
      }),
    } as unknown as PublicClient;
    return { client, reads };
  };

  it("reads the chain once, then answers from memory until the time is up", async () => {
    const vault = address(21);
    clearReleaseNudge(deployment.chainId, vault);
    const { client, reads } = clientFor(v1Impl);
    let t = 1_000;
    expect((await menuReleaseNudge(client, deployment, vault, () => t)).hasNudge).toBe(true);
    expect((await menuReleaseNudge(client, deployment, vault, () => t + 5_000)).hasNudge).toBe(true);
    expect(reads.count).toBe(1);
    t += NUDGE_TTL_MS + 1;
    await menuReleaseNudge(client, deployment, vault, () => t);
    expect(reads.count).toBe(2);
  });

  it("forgets on request (the Vault's release just changed) and never remembers a failed read", async () => {
    const vault = address(22);
    clearReleaseNudge(deployment.chainId, vault);
    const first = clientFor(v1Impl);
    await menuReleaseNudge(first.client, deployment, vault, () => 1);
    clearReleaseNudge(deployment.chainId, vault);
    const upgraded = clientFor(v2Impl);
    expect((await menuReleaseNudge(upgraded.client, deployment, vault, () => 2)).hasNudge).toBe(false);

    const other = address(23);
    clearReleaseNudge(deployment.chainId, other);
    const broken = clientFor(v1Impl, true);
    expect((await menuReleaseNudge(broken.client, deployment, other, () => 1)).hasNudge).toBe(false);
    const healthy = clientFor(v1Impl);
    expect((await menuReleaseNudge(healthy.client, deployment, other, () => 2)).hasNudge).toBe(true);
  });
});
