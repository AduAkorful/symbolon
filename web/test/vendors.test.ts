import { beforeAll, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { createTestDb, businesses, members, payees, seals, users, vendorVerifications } from "@symbolon/db";

vi.mock("server-only", () => ({}));
vi.mock("@symbolon/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@symbolon/chain")>()),
  symbolonContracts: () => ({ lens: { read: { getPayee: async () => { throw new Error("not expected without a Vault"); } } } }),
}));

import { vendorDetail } from "@/lib/server/vendors";
import { blockSeal } from "@/lib/server/inbox";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });
const address = (n: number) => "0x" + n.toString(16).padStart(40, "0");

async function business(name: string, role: "owner" | "approver" = "owner") {
  const [user] = await db.insert(users).values({ email: name.toLowerCase() + "-" + crypto.randomUUID() + "@example.test" }).returning();
  const [b] = await db.insert(businesses).values({ name, chainId: arcTestnet.id }).returning();
  await db.insert(members).values({ businessId: b!.id, userId: user!.id, role });
  return { user: user!, business: b! };
}

describe("business vendor detail", () => {
  it("returns the relationship and verification evidence only to members of that business", async () => {
    const client = await business("Northwind");
    const other = await business("Southwind");
    const [vendor] = await db.insert(users).values({ email: "seal-" + crypto.randomUUID() + "@example.test" }).returning();
    const seal = address(50);
    await db.insert(seals).values({ address: seal, userId: vendor!.id, handle: "vendor-" + crypto.randomUUID().slice(0, 8), displayName: "Northstar Studio" });
    await db.insert(payees).values({ businessId: client.business.id, seal, status: "verified", verificationMethod: "code", verifiedBy: client.user.id, verifiedAt: new Date() });
    await db.insert(vendorVerifications).values({ businessId: client.business.id, seal, method: "code", status: "verified", raisedBy: client.user.id, confirmedBy: client.user.id, codeHmac: "hmac", codeCiphertext: "encrypted", expiresAt: new Date(), contacted: "Jordan", channel: "known switchboard" });

    const detail = await vendorDetail(db, {} as never, getDeployment(arcTestnet.id), client.user, client.business.id, seal);
    expect(detail).toMatchObject({ seal, name: "Northstar Studio", status: "verified", verificationHistory: [{ method: "code", status: "verified", contacted: "Jordan", channel: "known switchboard", raisedBy: client.user.email }] });
    await expect(vendorDetail(db, {} as never, getDeployment(arcTestnet.id), other.user, other.business.id, seal))
      .rejects.toMatchObject({ status: 404 });
  });

  it("does not reveal whether a malformed Seal exists", async () => {
    const client = await business("Northwind");
    await expect(vendorDetail(db, {} as never, getDeployment(arcTestnet.id), client.user, client.business.id, "not-an-address"))
      .rejects.toBeInstanceOf(AuthError);
  });

  it("allows an approver to block a Seal but reserves unblocking for the owner", async () => {
    const approver = await business("Northwind-Approver", "approver");
    const owner = await business("Northwind-Owner");
    await expect(blockSeal(db, { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) }, approver.user, approver.business.id, address(80), true))
      .resolves.toMatchObject({ status: "blocked" });
    await expect(blockSeal(db, { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) }, approver.user, approver.business.id, address(80), false))
      .rejects.toMatchObject({ status: 403 });
    await expect(blockSeal(db, { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) }, owner.user, approver.business.id, address(80), false))
      .rejects.toMatchObject({ status: 403 });
  });
});
