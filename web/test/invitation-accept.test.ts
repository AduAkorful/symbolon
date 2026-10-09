import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, members, payees, seals, users, vendorInvitations, vendorVerifications } from "@symbolon/db";
import { eq } from "drizzle-orm";
import type { PublicClient } from "viem";

import { chainDouble, chainState } from "./setup-shared";

import { acceptInvitation, createInvitation } from "@/lib/server/invitations";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });
beforeEach(() => {
  chainDouble.enabled = true;
  chainState.getVaultState.mockResolvedValue({ policy: { ownerThreshold: 100n } });
});

const deployment = getDeployment(arcTestnet.id);
const client = {} as PublicClient;
let n = 0;
const address = () => `0x${(++n).toString(16).padStart(40, "0")}`;
const tokenOf = (link: string) => link.split("/").at(-1)!;

async function fixture() {
  const [owner] = await db.insert(users).values({ wallet: address() }).returning();
  const [vendor] = await db.insert(users).values({ wallet: address() }).returning();
  const [business] = await db.insert(businesses).values({ name: "Acme", chainId: arcTestnet.id, vault: address() }).returning();
  await db.insert(members).values({ businessId: business!.id, userId: owner!.id, role: "owner" });
  const seal = address();
  await db.insert(seals).values({ address: seal, userId: vendor!.id, handle: `v-${n}`, displayName: "Northstar" });
  return { owner: owner!, vendor: vendor!, business: business!, seal };
}
const invite = (f: Awaited<ReturnType<typeof fixture>>, terms?: unknown) =>
  createInvitation(db, f.owner, f.business.id, { vendorName: "Northstar", contactNote: "Known AP line", ...(terms ? { terms } : {}) }, "https://app.example.test");

describe("accepting an invitation", () => {
  it("verifies the accepting Seal by invitation and spends the link", async () => {
    const f = await fixture();
    const token = tokenOf((await invite(f)).link);
    await expect(acceptInvitation(db, client, deployment, f.vendor, token)).resolves.toMatchObject({ status: "verified", seal: f.seal });
    const [payee] = await db.select().from(payees).where(eq(payees.businessId, f.business.id));
    expect(payee).toMatchObject({ status: "verified", verificationMethod: "invitation", verifiedBy: f.owner.id });
    await expect(acceptInvitation(db, client, deployment, f.vendor, token)).rejects.toMatchObject({ status: 404, message: "This invitation can't be used." });
  });

  it("lets only one of two simultaneous acceptances win", async () => {
    const f = await fixture();
    const token = tokenOf((await invite(f)).link);
    const results = await Promise.allSettled([acceptInvitation(db, client, deployment, f.vendor, token), acceptInvitation(db, client, deployment, f.vendor, token)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(vendorVerifications).where(eq(vendorVerifications.businessId, f.business.id))).toHaveLength(1);
  });

  it("refuses an expired link, a link revoked in the meantime, and someone with no Seal", async () => {
    const f = await fixture();
    const expired = await invite(f);
    await db.update(vendorInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(vendorInvitations.id, expired.id));
    await expect(acceptInvitation(db, client, deployment, f.vendor, tokenOf(expired.link))).rejects.toMatchObject({ status: 404 });
    const [noSeal] = await db.insert(users).values({ wallet: address() }).returning();
    await expect(acceptInvitation(db, client, deployment, noSeal!, tokenOf((await invite(f)).link))).rejects.toMatchObject({ status: 409 });
  });

  it("cannot override a block", async () => {
    const f = await fixture();
    await db.insert(payees).values({ businessId: f.business.id, seal: f.seal, status: "blocked" });
    await expect(acceptInvitation(db, client, deployment, f.vendor, tokenOf((await invite(f)).link))).rejects.toMatchObject({ status: 403 });
    const [payee] = await db.select().from(payees).where(eq(payees.businessId, f.business.id));
    expect(payee!.status).toBe("blocked");
  });

  it("waits for a second person when the offered cap is over the live threshold", async () => {
    const f = await fixture();
    const made = await invite(f, { monthlyCap: "101", requirePo: false, requireDelivery: false });
    await expect(acceptInvitation(db, client, deployment, f.vendor, tokenOf(made.link))).resolves.toMatchObject({ status: "awaiting_second" });
    const [payee] = await db.select().from(payees).where(eq(payees.businessId, f.business.id));
    expect(payee!.status).toBe("pending_verification");
  });

  it("does not downgrade a Seal the business already verified", async () => {
    const f = await fixture();
    await db.insert(payees).values({ businessId: f.business.id, seal: f.seal, status: "verified", verificationMethod: "code", verifiedBy: f.owner.id, verifiedAt: new Date() });
    const made = await invite(f, { monthlyCap: "101", requirePo: false, requireDelivery: false });
    await expect(acceptInvitation(db, client, deployment, f.vendor, tokenOf(made.link))).resolves.toMatchObject({ status: "verified" });
    const [payee] = await db.select().from(payees).where(eq(payees.businessId, f.business.id));
    expect(payee!.status).toBe("verified");
  });
});
