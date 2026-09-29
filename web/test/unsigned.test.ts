import { beforeAll, describe, expect, it, vi } from "vitest";
import { arcTestnet } from "@symbolon/chain";
import { businesses, createTestDb, members, unsignedBills, users, vendorInvitations } from "@symbolon/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { askForSealed, updateUnsignedBill } from "@/lib/server/unsigned";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });

let n = 0;
const address = () => `0x${(++n).toString(16).padStart(40, "0")}`;

async function fixture() {
  const [owner] = await db.insert(users).values({ wallet: address() }).returning();
  const [approver] = await db.insert(users).values({ wallet: address() }).returning();
  const [business] = await db.insert(businesses).values({ name: "Acme", chainId: arcTestnet.id, vault: address() }).returning();
  await db.insert(members).values([{ businessId: business!.id, userId: owner!.id, role: "owner" }, { businessId: business!.id, userId: approver!.id, role: "approver" }]);
  const [bill] = await db.insert(unsignedBills).values({ businessId: business!.id, uploadedBy: owner!.id, fileName: "bill.pdf", fileSha256: `0x${(++n).toString(16).padStart(64, "0")}`, extraction: { vendorName: "Northstar", payerEmail: "billing@northstar.example" }, assessment: { verdict: "unsigned", reasons: [] } }).returning();
  return { owner: owner!, approver: approver!, business: business!, bill: bill! };
}

describe("unsigned bills", () => {
  it("asks for a sealed invoice with a one-use link to the contact the member typed, and marks the bill invited", async () => {
    const f = await fixture();
    const made = await askForSealed(db, f.owner, f.business.id, f.bill.id, { vendorName: "Northstar", contactNote: "finance desk number on our contract" }, "https://app.example.test");
    expect(made.link).toMatch(/^https:\/\/app\.example\.test\/invite\/[A-Za-z0-9_-]{43}$/);
    const [invitation] = await db.select().from(vendorInvitations).where(eq(vendorInvitations.id, made.id));
    expect(invitation!.contactNote).toBe("finance desk number on our contract");
    expect(JSON.stringify(invitation)).not.toContain("billing@northstar.example");
    const [bill] = await db.select().from(unsignedBills).where(eq(unsignedBills.id, f.bill.id));
    expect(bill!.status).toBe("invited");
  });

  it("is the owner's action, and never for another business's bill", async () => {
    const f = await fixture();
    const g = await fixture();
    await expect(askForSealed(db, f.approver, f.business.id, f.bill.id, { vendorName: "N", contactNote: "c" }, "https://app.example.test")).rejects.toMatchObject({ status: 403 });
    await expect(askForSealed(db, g.owner, g.business.id, f.bill.id, { vendorName: "N", contactNote: "c" }, "https://app.example.test")).rejects.toMatchObject({ status: 404 });
  });

  it("resolves an open bill once: a fraud mark is not turned into a dismissal", async () => {
    const f = await fixture();
    await expect(updateUnsignedBill(db, f.approver, f.business.id, f.bill.id, "fraud")).resolves.toMatchObject({ status: "fraud" });
    await expect(updateUnsignedBill(db, f.approver, f.business.id, f.bill.id, "dismissed")).rejects.toMatchObject({ status: 404 });
  });
});
