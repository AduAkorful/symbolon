import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { createTestDb, invoices, users } from "@symbolon/db";
import { sealDomain, signSealMessage, toInvoice, typedData } from "@symbolon/seal";
import { eq } from "drizzle-orm";
import { prepareInvoice, sendInvoice } from "@/lib/server/invoice-send";
import { loadPublicInvoice } from "@/lib/server/public-invoice";
import { registerMySeal } from "@/lib/server/vendor";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
const NOW = new Date("2026-09-29T12:00:00Z");

const chain = (o: { down?: boolean; credited?: bigint; seen?: boolean } = {}) =>
  ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "decimals") return 6;
      if (o.down) throw new Error("rpc down");
      if (functionName === "status") return { seen: o.seen ?? false, seal: "0x0000000000000000000000000000000000000000", total: 100_000_000n, credited: o.credited ?? 0n, cancelled: false };
      if (functionName === "remaining") return 100_000_000n - (o.credited ?? 0n);
      throw new Error(`unexpected ${functionName}`);
    },
    getCode: async () => undefined,
    call: async () => ({ data: undefined }),
  }) as unknown as PublicClient;

async function sentInvoice(handle: string) {
  const account = privateKeyToAccount(generatePrivateKey());
  const [u] = await db.insert(users).values({ wallet: account.address.toLowerCase() }).returning();
  await registerMySeal(db, u!, { handle, displayName: "Studio Ana" });
  const p = await prepareInvoice(db, chain(), cfg, u!, { client: { name: "Acme", vault: "0x2222222222222222222222222222222222222222" }, currency: "USDC", invoiceNumber: "0144", dueDays: 30, lines: [{ description: "Work", quantity: "1", unitPrice: "100" }] }, NOW);
  const signature = await signSealMessage(account, typedData(sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger), "Invoice", toInvoice(p.document)));
  await sendInvoice(db, chain(), cfg, u!, { document: p.document, signature });
  return { fingerprint: p.fingerprint, account };
}

describe("the public invoice link", () => {
  it("shows a genuine invoice with its Seal and what the ledger says", async () => {
    const { fingerprint, account } = await sentInvoice("public-one-a");
    const v = await loadPublicInvoice(db, chain(), cfg, fingerprint);
    expect(v?.state).toBe("genuine");
    if (v?.state !== "genuine") return;
    expect(v.seal).toEqual({ address: account.address.toLowerCase(), handle: "public-one-a", verifiedDomain: null });
    expect(v.document.total).toBe("100.000000");
    expect(v.ledger).toMatchObject({ ok: true, status: { seen: false, paid: false } });
    expect(JSON.parse(v.envelope).document.invoiceNumber).toBe("0144");
  });

  it("reads payment live, and says so plainly when it can't", async () => {
    const { fingerprint } = await sentInvoice("public-two-b");
    const paid = await loadPublicInvoice(db, chain({ seen: true, credited: 100_000_000n }), cfg, fingerprint);
    expect(paid?.state === "genuine" && paid.ledger).toMatchObject({ ok: true, status: { paid: true } });
    const down = await loadPublicInvoice(db, chain({ down: true }), cfg, fingerprint);
    expect(down?.state === "genuine" && down.ledger).toEqual({ ok: false, reason: "Can't read the ledger on Arc right now." });
  });

  it("does not know an unknown or malformed fingerprint, or a rejected row", async () => {
    expect(await loadPublicInvoice(db, chain(), cfg, `0x${"00".repeat(32)}`)).toBeNull();
    expect(await loadPublicInvoice(db, chain(), cfg, "0xnot")).toBeNull();
    expect(await loadPublicInvoice(db, chain(), cfg, `0x${"AB".repeat(32)}`)).toBeNull();
    const { fingerprint } = await sentInvoice("public-three-c");
    await db.update(invoices).set({ status: "rejected" }).where(eq(invoices.fingerprint, fingerprint));
    expect(await loadPublicInvoice(db, chain(), cfg, fingerprint)).toBeNull();
  });

  it("checks again on every request: a stored envelope changed in the database is shown as failing, never genuine", async () => {
    const { fingerprint } = await sentInvoice("public-four-d");
    const [row] = await db.select().from(invoices).where(eq(invoices.fingerprint, fingerprint));
    await db.update(invoices).set({ envelope: row!.envelope.replace("Studio Ana", "Studio Anb") }).where(eq(invoices.fingerprint, fingerprint));
    const v = await loadPublicInvoice(db, chain(), cfg, fingerprint);
    expect(v?.state).toBe("failed");
    if (v?.state === "failed") expect(v.issues.length).toBeGreaterThan(0);
  });

  it("shows a stored envelope moved to a different fingerprint as failing", async () => {
    const a = await sentInvoice("public-five-e");
    const b = await sentInvoice("public-six-f");
    const [rowA] = await db.select().from(invoices).where(eq(invoices.fingerprint, a.fingerprint));
    await db.update(invoices).set({ envelope: rowA!.envelope }).where(eq(invoices.fingerprint, b.fingerprint));
    expect((await loadPublicInvoice(db, chain(), cfg, b.fingerprint))?.state).toBe("failed");
  });
});
