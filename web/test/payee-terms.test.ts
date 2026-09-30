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
import { preparePayeeTerms } from "@/lib/server/payee-terms";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

const address = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Hex;
const deployment = getDeployment(arcTestnet.id);
let userNo = 7000;
let vaultNo = 1100;

async function fixture() {
  const [owner] = await db
    .insert(users)
    .values({
      email: `terms-owner-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const [viewer] = await db
    .insert(users)
    .values({
      email: `terms-viewer-${crypto.randomUUID()}@example.test`,
      wallet: address(++userNo),
    })
    .returning();

  const vault = address(++vaultNo);
  const [biz] = await db
    .insert(businesses)
    .values({
      name: "Acme Terms",
      chainId: arcTestnet.id,
      vault: vault,
    })
    .returning();

  if (!owner || !viewer || !biz) throw new Error("setup failed");

  await db.insert(members).values([
    { businessId: biz.id, userId: owner.id, role: "owner" },
    { businessId: biz.id, userId: viewer.id, role: "viewer" },
  ]);

  return { owner, viewer, biz, vault };
}

describe("payee-terms service", () => {
  const OPERATING_BUDGET: Hex =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const OTHER_BUDGET: Hex =
    "0x1111111111111111111111111111111111111111111111111111111111111111";

  const currentPayee = {
    exists: true,
    terms: {
      budget: OPERATING_BUDGET,
      requirePo: true,
      requireDelivery: true,
      monthlyCap: 10_000_000_000n,
    },
  };

  it("preparePayeeTerms checks owner and payee existence", async () => {
    const f = await fixture();
    const seal = address(9999);

    const mockClient = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000n }),
      readContract: vi.fn().mockImplementation(async ({ functionName, args }) => {
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
        if (functionName === "getPayee") {
          if (args[1]?.toLowerCase() === seal.toLowerCase()) {
            return currentPayee;
          }
          return { exists: false };
        }
        return null;
      }),
    } as unknown as PublicClient;

    // Viewer is refused
    await expect(
      preparePayeeTerms(db, mockClient, deployment, f.viewer, f.biz.id, {
        seal,
        terms: {
          budget: OPERATING_BUDGET,
          requirePo: true,
          requireDelivery: true,
          monthlyCap: 5_000_000_000n,
        },
      }),
    ).rejects.toThrow(AuthError);

    // Non-existent payee is 404
    await expect(
      preparePayeeTerms(db, mockClient, deployment, f.owner, f.biz.id, {
        seal: address(1234),
        terms: {
          budget: OPERATING_BUDGET,
          requirePo: true,
          requireDelivery: true,
          monthlyCap: 5_000_000_000n,
        },
      }),
    ).rejects.toThrow(AuthError);

    // Tightening (lower cap) -> apply-now
    const tightening = await preparePayeeTerms(
      db,
      mockClient,
      deployment,
      f.owner,
      f.biz.id,
      {
        seal,
        terms: {
          budget: OPERATING_BUDGET,
          requirePo: true,
          requireDelivery: true,
          monthlyCap: 5_000_000_000n,
        },
      },
    );
    expect(tightening.isLooser).toBe(false);
    expect(tightening.state).toBe("apply-now");

    // Loosening (higher cap) -> will-queue
    const loosening = await preparePayeeTerms(
      db,
      mockClient,
      deployment,
      f.owner,
      f.biz.id,
      {
        seal,
        terms: {
          budget: OPERATING_BUDGET,
          requirePo: true,
          requireDelivery: true,
          monthlyCap: 20_000_000_000n,
        },
      },
    );
    expect(loosening.isLooser).toBe(true);
    expect(loosening.state).toBe("will-queue");
  });
});
