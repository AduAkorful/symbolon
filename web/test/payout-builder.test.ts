import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type PublicClient } from "viem";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, payees, seals, users } from "@symbolon/db";
vi.mock("server-only", () => ({}));
import { prepareVendorPayoutChange } from "@/lib/server/payout-change";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db.$client.close(); });
const address = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };

describe("payout preparation with the real contract builder", () => {
  it("reads every business at the registry lens and exposes failed reads as unavailable", async () => {
    const seal = address();
    const [user] = await db.insert(users).values({ wallet: seal }).returning();
    await db.insert(seals).values({ userId: user!.id, address: seal, handle: `vendor-${crypto.randomUUID().slice(0, 8)}`, displayName: "Vendor" });
    const [business] = await db.insert(businesses).values({ name: "Payer", chainId: cfg.chainId, vault: address() }).returning();
    await db.insert(payees).values({ businessId: business!.id, seal, status: "pending_verification" });
    const readContract = vi.fn().mockImplementation(async ({ address: target, functionName, args }) => {
      expect(target.toLowerCase()).toBe(cfg.deployment.contracts.vaultLens.toLowerCase());
      expect(functionName).toBe("getPayee");
      expect(args[0].toLowerCase()).toBe(business!.vault);
      return { exists: true, lastChangeNonce: 100n };
    });
    const client = { readContract } as unknown as PublicClient;
    const result = await prepareVendorPayoutChange(db, client, cfg, user!, { newPayout: address() });
    expect(result.businesses).toHaveLength(1);
    readContract.mockRejectedValue(new Error("RPC unavailable"));
    await expect(prepareVendorPayoutChange(db, client, cfg, user!, { newPayout: address() })).rejects.toMatchObject({ status: 502 });
  });
});
