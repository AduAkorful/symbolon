import { beforeAll, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, invoices, members, users } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice } from "@symbolon/seal";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { eq } from "drizzle-orm";
import { addSealedInvoice, claimable } from "@/lib/server/inbox";

vi.mock("server-only", () => ({}));

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });

const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
const client = {} as PublicClient;
const sealKey = privateKeyToAccount(generatePrivateKey());
const address = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

async function envelopeTo(vault: string, number: string) {
  const document = completeTotals({
    schema: "symbolon.invoice.v1",
    seal: sealKey.address.toLowerCase(),
    vendor: { name: "Studio Ana" },
    payer: { name: "Acme", vault },
    invoiceNumber: number,
    issuedAt: 1_790_000_000,
    dueDate: 1_792_592_000,
    currency: { chainId: cfg.chainId, token: cfg.deployment.tokens.usdc.toLowerCase(), symbol: "USDC", decimals: 6 },
    lineItems: [{ description: "Work", quantity: "1", unitPrice: "100" }],
    taxes: [],
    discounts: [],
    payout: { address: address(), domain: 26 },
    earlyPay: [],
    attachments: [],
  } as never);
  const { sealed, fingerprint } = await sealInvoice({ signer: sealKey, chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger, document });
  return { envelope: encodeSealedInvoice(sealed), fingerprint };
}

async function member(role: "owner" | "viewer", vault = address()) {
  const [user] = await db.insert(users).values({ wallet: address() }).returning();
  const [business] = await db.insert(businesses).values({ name: "Acme", chainId: cfg.chainId, vault }).returning();
  await db.insert(members).values({ businessId: business!.id, userId: user!.id, role });
  return { user: user!, business: business! };
}

describe("adding a sealed invoice to an inbox", () => {
  it("files an invoice addressed to this business's Vault", async () => {
    const m = await member("owner", "0x00000000000000000000000000000000000000c1");
    const { envelope, fingerprint } = await envelopeTo(m.business.vault!, "A-1");
    await expect(addSealedInvoice(db, client, cfg, m.user, m.business.id, envelope, "upload")).resolves.toEqual({ fingerprint });
    const [row] = await db.select().from(invoices).where(eq(invoices.fingerprint, fingerprint));
    expect(row).toMatchObject({ businessId: m.business.id, status: "verified", source: "upload" });
  });

  it("refuses an invoice addressed to someone else, and stores nothing", async () => {
    const m = await member("owner");
    const { envelope, fingerprint } = await envelopeTo("0x00000000000000000000000000000000000000d2", "B-1");
    await expect(addSealedInvoice(db, client, cfg, m.user, m.business.id, envelope, "upload")).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(invoices).where(eq(invoices.fingerprint, fingerprint))).toHaveLength(0);
  });

  it("refuses a viewer, and something that is not a sealed invoice", async () => {
    const viewer = await member("viewer", "0x00000000000000000000000000000000000000e3");
    const { envelope } = await envelopeTo(viewer.business.vault!, "C-1");
    await expect(addSealedInvoice(db, client, cfg, viewer.user, viewer.business.id, envelope, "upload")).rejects.toMatchObject({ status: 403 });
    const owner = await member("owner");
    await expect(addSealedInvoice(db, client, cfg, owner.user, owner.business.id, { nope: true }, "upload")).rejects.toMatchObject({ status: 400 });
  });

  it("lists nothing to claim for a viewer instead of failing the inbox", async () => {
    const viewer = await member("viewer");
    await expect(claimable(db, cfg, { ...viewer.user, email: "ap@acme.example" }, viewer.business.id)).resolves.toEqual([]);
  });
});
