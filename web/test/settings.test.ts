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
import { getAddress, type Hex, type PublicClient } from "viem";
import {
  loadSettings,
  renameBusiness,
  setBufferDays,
  setEarlyPay,
} from "@/lib/server/settings";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Hex;
const deployment = getDeployment(arcTestnet.id);
let userNo = 7000;
let vaultNo = 2000;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({
      email: `settings-owner-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [viewer] = await db
    .insert(users)
    .values({
      email: `settings-viewer-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [outsider] = await db
    .insert(users)
    .values({
      email: `settings-outsider-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const vault = address(++vaultNo);
  const [biz] = await db
    .insert(businesses)
    .values({
      name: "Acme Settings",
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

describe("settings service", () => {
  it("renameBusiness updates the business name and appends decision", async () => {
    const f = await fixture();

    const res = await renameBusiness(db, f.owner, f.biz.id, "Acme International");
    expect(res.ok).toBe(true);
    expect(res.name).toBe("Acme International");

    const [updated] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, f.biz.id))
      .limit(1);
    expect(updated!.name).toBe("Acme International");

    const decisionList = await db
      .select()
      .from(decisions)
      .where(eq(decisions.businessId, f.biz.id));
    const renameDecision = decisionList.find((d) => d.kind === "business_renamed");
    expect(renameDecision).toBeDefined();
    const rec = renameDecision?.record as Record<string, unknown>;
    expect((rec.inputs as Record<string, unknown>).next).toBe("Acme International");
  });


  it("renameBusiness validates inputs and access", async () => {
    const f = await fixture();

    // Empty name
    await expect(renameBusiness(db, f.owner, f.biz.id, "")).rejects.toThrow(AuthError);
    await expect(renameBusiness(db, f.owner, f.biz.id, "   ")).rejects.toThrow(AuthError);

    // Too long
    await expect(renameBusiness(db, f.owner, f.biz.id, "a".repeat(81))).rejects.toThrow(
      AuthError,
    );

    // Control characters
    await expect(renameBusiness(db, f.owner, f.biz.id, "Acme\nCorp")).rejects.toThrow(
      AuthError,
    );

    // Non-owner is refused
    await expect(renameBusiness(db, f.viewer, f.biz.id, "New Name")).rejects.toThrow(
      AuthError,
    );

    // Outsider is refused
    await expect(renameBusiness(db, f.outsider, f.biz.id, "New Name")).rejects.toThrow(
      AuthError,
    );
  });

  it("loadSettings returns business and onchain vault details", async () => {
    const f = await fixture();

    const mockClient = {
      getStorageAt: vi.fn().mockResolvedValue("0x00000000000000000000000002bcb1288338d47e31342737772d0b32bba3842a"),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
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
        if (functionName === "isSupportedToken") return true;
        return null;
      }),
    } as unknown as PublicClient;

    const data = await loadSettings(db, mockClient, deployment, f.viewer, f.biz.id);
    expect(data.business.name).toBe("Acme Settings");
    expect(data.vaultDetails?.owner).toBe(getAddress(f.owner.wallet!));
    expect(data.vaultDetails?.currentImplementation).toBe("0x02bCb1288338d47e31342737772D0b32bBA3842A");
    expect(data.vaultDetails?.supportedTokens.length).toBeGreaterThan(0);

    // Outsider is refused
    await expect(
      loadSettings(db, mockClient, deployment, f.outsider, f.biz.id),
    ).rejects.toThrow(AuthError);
  });

  it("setEarlyPay and setBufferDays are owner only", async () => {
    const f = await fixture();

    // Owner sets Early Pay
    const epRes = await setEarlyPay(db, f.owner, f.biz.id, {
      enabled: true,
      minSpreadBps: 200,
      cashCapBps: 5000,
    });
    expect(epRes.ok).toBe(true);
    expect(epRes.earlyPay.enabled).toBe(true);

    // Viewer cannot set Early Pay
    await expect(
      setEarlyPay(db, f.viewer, f.biz.id, {
        enabled: false,
        minSpreadBps: 0,
        cashCapBps: 0,
      }),
    ).rejects.toThrow(AuthError);

    // Owner sets Buffer Days
    const bufRes = await setBufferDays(db, f.owner, f.biz.id, 45);
    expect(bufRes.ok).toBe(true);
    expect(bufRes.bufferDays).toBe(45);

    // Viewer cannot set Buffer Days
    await expect(setBufferDays(db, f.viewer, f.biz.id, 60)).rejects.toThrow(AuthError);
  });
});
