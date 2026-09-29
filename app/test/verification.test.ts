import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { createTestDb, businesses, invoices, members, payees, seals, users, vendorVerifications } from "@symbolon/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("@symbolon/chain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@symbolon/chain")>()),
  symbolonContracts: () => ({ lens: { read: { getVaultState: async () => ({ policy: { ownerThreshold: 100n } }) } } }),
}));

import { confirmSecond, showCodeToSeal, startCodeVerification, submitCode } from "@/lib/server/verification";

let db: Awaited<ReturnType<typeof createTestDb>>;
const oldKey = process.env.VERIFICATION_CODE_KEY;
beforeAll(async () => { process.env.VERIFICATION_CODE_KEY = "ab".repeat(32); db = await createTestDb(); });
afterAll(() => { if (oldKey === undefined) delete process.env.VERIFICATION_CODE_KEY; else process.env.VERIFICATION_CODE_KEY = oldKey; });

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
let n = 100;

async function fixture(total: bigint) {
  const [owner] = await db.insert(users).values({ email: `owner-${n}@example.test` }).returning();
  const [approver] = await db.insert(users).values({ email: `approver-${n}@example.test` }).returning();
  const [second] = await db.insert(users).values({ email: `second-${n}@example.test` }).returning();
  const [vendor] = await db.insert(users).values({ email: `vendor-${n}@example.test` }).returning();
  const seal = address(++n);
  const [business] = await db.insert(businesses).values({ name: "Acme", chainId: arcTestnet.id, vault: address(++n) }).returning();
  await db.insert(members).values([
    { businessId: business!.id, userId: owner!.id, role: "owner" },
    { businessId: business!.id, userId: approver!.id, role: "approver" },
    { businessId: business!.id, userId: second!.id, role: "approver" },
  ]);
  await db.insert(seals).values({ address: seal, userId: vendor!.id, handle: `vendor-${n}`, displayName: "Northstar" });
  const fingerprint = hash(n++);
  await db.insert(invoices).values({ fingerprint, chainId: arcTestnet.id, ledger: address(1), seal, businessId: business!.id, payerRef: hash(0), invoiceNumber: `INV-${n}`, token: address(2), total, dueDate: new Date(Date.now() + 86_400_000), envelope: "{}", source: "link" });
  return { owner: owner!, approver: approver!, second: second!, vendor: vendor!, seal, business: business!, fingerprint };
}

const client = {} as never;
const deployment = getDeployment(arcTestnet.id);

describe("vendor callback verification", () => {
  it("shows decrypted code only to the Seal owner; successful low-value check records evidence", async () => {
    const f = await fixture(50n);
    const request = await startCodeVerification(db, f.owner, f.business.id, f.seal);
    const [stored] = await db.select().from(vendorVerifications).where(eq(vendorVerifications.id, request.id));
    expect(stored!.codeCiphertext).not.toContain(stored!.codeHmac);
    expect((await showCodeToSeal(db, f.owner)).find((x) => x.id === request.id)).toBeUndefined();
    const shown = (await showCodeToSeal(db, f.vendor)).find((x) => x.id === request.id);
    expect(shown?.code).toMatch(/^\d{6}$/);
    await expect(submitCode(db, f.approver, client, deployment, request.id, shown!.code, "Jordan", "known switchboard")).resolves.toEqual({ status: "verified" });
    const [payee] = await db.select().from(payees).where(eq(payees.businessId, f.business.id));
    expect(payee).toMatchObject({ status: "verified", verificationMethod: "code", verifiedBy: f.approver.id });
  });

  it("requires a distinct second member when the largest invoice exceeds the live threshold", async () => {
    const f = await fixture(101n);
    const request = await startCodeVerification(db, f.owner, f.business.id, f.seal);
    const code = (await showCodeToSeal(db, f.vendor)).find((x) => x.id === request.id)!.code;
    await expect(submitCode(db, f.approver, client, deployment, request.id, code, "Jordan", "known switchboard")).resolves.toEqual({ status: "awaiting_second" });
    await expect(confirmSecond(db, f.approver, request.id)).rejects.toThrow();
    await expect(confirmSecond(db, f.second, request.id)).resolves.toEqual({ status: "verified" });
  });

  it("expires a code after five incorrect guesses and appends each refusal", async () => {
    const f = await fixture(40n);
    const request = await startCodeVerification(db, f.owner, f.business.id, f.seal);
    for (let i = 0; i < 5; i++) await expect(submitCode(db, f.approver, client, deployment, request.id, "999999", "Jordan", "known switchboard")).rejects.toThrow();
    const [row] = await db.select().from(vendorVerifications).where(eq(vendorVerifications.id, request.id));
    expect(row).toMatchObject({ status: "expired", attempts: 5 });
  });
});
