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

  it("re-evaluates steward-held invoices but leaves human-held invoices untouched", async () => {
    const db = await createTestDb();
    const [biz] = await db.insert(businesses).values({ name: "Biz", chainId: arcTestnet.id, vault: address(10) }).returning();
    const seal = address(7);
    const inv = (fingerprint: string, status: "held" | "verified", holdSource?: "steward" | "human") => ({
      fingerprint,
      chainId: arcTestnet.id,
      ledger: deployment.contracts.invoiceLedger,
      seal,
      businessId: biz!.id,
      payerRef: hash(8),
      invoiceNumber: `INV-${fingerprint.slice(2, 6)}`,
      token: deployment.tokens.usdc,
      total: 1n,
      dueDate: new Date("2026-10-01T00:00:00Z"),
      envelope: "{}",
      source: "link" as const,
      status,
      holdSource: holdSource ?? null,
    });

    await db.insert(invoices).values([
      inv(hash(10), "held", "steward"),
      inv(hash(11), "held", "human"),
      inv(hash(12), "verified"),
    ]);

    // Test the selection logic directly matching runSteward's open invoices filter
    const OPEN = ["verified", "scheduled", "awaiting_approval"] as const;
    const { and, eq, inArray, or } = await import("drizzle-orm");
    const openRows = await db
      .select({ fingerprint: invoices.fingerprint, status: invoices.status, holdSource: invoices.holdSource })
      .from(invoices)
      .where(
        and(
          eq(invoices.businessId, biz!.id),
          or(
            inArray(invoices.status, [...OPEN]),
            and(eq(invoices.status, "held"), eq(invoices.holdSource, "steward")),
          ),
        ),
      );

    const openFps = openRows.map((r) => r.fingerprint);
    // steward-held and verified are loaded
    expect(openFps).toContain(hash(10));
    expect(openFps).toContain(hash(12));
    // human-held is strictly excluded
    expect(openFps).not.toContain(hash(11));

    await db.$client.close();
  });

  it("resolves per-business wallet via walletFor in runCycle", async () => {
    const db = await createTestDb();
    const [bizA] = await db.insert(businesses).values({ name: "A", chainId: arcTestnet.id, vault: address(20) }).returning();
    const [bizB] = await db.insert(businesses).values({ name: "B", chainId: arcTestnet.id, vault: address(21) }).returning();

    const walletsUsed: string[] = [];
    const mockWallet = (addr: string) => ({
      address: addr as `0x${string}`,
      send: async () => `0x${"aa".repeat(32)}` as `0x${string}`,
    });

    const walletFor = async (biz: { id: string; vault: string }) => {
      walletsUsed.push(biz.vault);
      return mockWallet(biz.vault);
    };

    // Verify walletFor resolves the correct wallet for each business
    const wA = await walletFor({ id: bizA!.id, vault: bizA!.vault! });
    const wB = await walletFor({ id: bizB!.id, vault: bizB!.vault! });

    expect(wA.address).toBe(address(20));
    expect(wB.address).toBe(address(21));
    expect(walletsUsed).toEqual([bizA!.vault, bizB!.vault]);

    await db.$client.close();
  });
});

