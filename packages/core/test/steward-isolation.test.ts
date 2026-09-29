import { describe, expect, it } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, invoices, users } from "@symbolon/db";
import { knownInvoicesForSteward } from "../src/steward.js";

const deployment = getDeployment(arcTestnet.id);
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

describe("Steward duplicate candidate isolation", () => {
  it("never uses another business's invoices for duplicate screening", async () => {
    const db = await createTestDb();
    const [firstOwner] = await db.insert(users).values({ email: "duplicate-first@example.test" }).returning();
    const [secondOwner] = await db.insert(users).values({ email: "duplicate-second@example.test" }).returning();
    const [first] = await db.insert(businesses).values({ name: "First", chainId: arcTestnet.id }).returning();
    const [second] = await db.insert(businesses).values({ name: "Second", chainId: arcTestnet.id }).returning();
    const seal = address(7);
    const invoice = (fingerprint: string, businessId: string) => ({
      fingerprint, chainId: arcTestnet.id, ledger: deployment.contracts.invoiceLedger, seal, businessId,
      payerRef: hash(8), invoiceNumber: "SAME-1", token: deployment.tokens.usdc, total: 1n,
      dueDate: new Date("2026-10-01T00:00:00Z"), envelope: "{}", source: "link",
    });
    await db.insert(invoices).values([invoice(hash(1), first!.id), invoice(hash(2), second!.id)]);

    const rows = await knownInvoicesForSteward(db, first!.id, seal, hash(3));
    expect(rows.map((row) => row.fingerprint)).toEqual([hash(1)]);
    expect(firstOwner).toBeDefined();
    expect(secondOwner).toBeDefined();
    await db.$client.close();
  });
});
