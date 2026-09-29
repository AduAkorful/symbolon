import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { createTestDb, invoices, users } from "@symbolon/db";
import { sealDomain, signSealMessage, toInvoice, typedData, fingerprint, decodeSealedInvoice, type InvoiceDocument } from "@symbolon/seal";
import { eq } from "drizzle-orm";
import { AuthError } from "@/lib/server/errors";
import type { ComposerDraft } from "@/lib/server/compose";
import { listMyInvoices, myInvoice, nextInvoiceNumber, prepareInvoice, sendInvoice } from "@/lib/server/invoice-send";
import { listClients, registerMySeal } from "@/lib/server/vendor";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
const LEDGER = cfg.deployment.contracts.invoiceLedger;
const VAULT = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-09-29T12:00:00Z");

/** A chain that knows a token's decimals, and (like an EOA) has no code at the signer */
const chain = (decimals: number | "down" = 6) =>
  ({
    readContract: async () => {
      if (decimals === "down") throw new Error("rpc down");
      return decimals;
    },
    getCode: async () => undefined,
    call: async () => ({ data: undefined }),
  }) as unknown as PublicClient;

let n = 0;
async function vendor() {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  const [u] = await db.insert(users).values({ wallet: account.address.toLowerCase() }).returning();
  await registerMySeal(db, u!, { handle: `vendor-${++n}-z`, displayName: "Studio Ana" });
  return { user: u!, account };
}

const draft = (over: Partial<ComposerDraft> = {}): ComposerDraft => ({
  client: { name: "Acme Operations", vault: VAULT },
  currency: "USDC",
  invoiceNumber: "0144",
  dueDays: 30,
  lines: [{ description: "Brand refresh", quantity: "1", unitPrice: "1600" }],
  ...over,
});

const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  return e as AuthError;
};

/** What the browser does: sign the typed data the server prepared */
async function sign(account: ReturnType<typeof privateKeyToAccount>, document: InvoiceDocument, ledger = LEDGER) {
  return signSealMessage(account, typedData(sealDomain(cfg.chainId, ledger), "Invoice", toInvoice(document)));
}

describe("prepareInvoice", () => {
  it("builds the document and the typed data for the same invoice", async () => {
    const { user, account } = await vendor();
    const p = await prepareInvoice(db, chain(), cfg, user, draft(), NOW);
    const payload = JSON.parse(p.typedData);
    expect(payload.primaryType).toBe("Invoice");
    expect(payload.domain).toMatchObject({ chainId: cfg.chainId, verifyingContract: LEDGER });
    expect(payload.message.seal.toLowerCase()).toBe(account.address.toLowerCase());
    // the fingerprint the ledger will use is the digest of exactly that invoice
    expect(p.fingerprint).toBe(fingerprint(sealDomain(cfg.chainId, LEDGER), toInvoice(p.document)));
    expect(p.document.currency.token).toBe(cfg.deployment.tokens.usdc.toLowerCase());
  });

  it("writes nothing", async () => {
    const { user } = await vendor();
    const before = (await db.select().from(invoices)).length;
    await prepareInvoice(db, chain(), cfg, user, draft(), NOW);
    expect((await db.select().from(invoices)).length).toBe(before);
  });

  it("reads the token's decimals from the chain and refuses when it can't", async () => {
    const { user } = await vendor();
    const p = await prepareInvoice(db, chain(18), cfg, user, draft(), NOW);
    expect(p.document.currency.decimals).toBe(18);
    expect(p.document.total).toBe("1600.000000000000000000");
    expect((await err(prepareInvoice(db, chain("down"), cfg, user, draft(), NOW))).status).toBe(503);
  });

  it("needs a Seal, a valid draft and a currency", async () => {
    const [nobody] = await db.insert(users).values({ wallet: privateKeyToAccount(generatePrivateKey()).address.toLowerCase() }).returning();
    expect((await err(prepareInvoice(db, chain(), cfg, nobody!, draft(), NOW))).status).toBe(403);
    const { user } = await vendor();
    expect((await err(prepareInvoice(db, chain(), cfg, user, draft({ currency: "BTC" }), NOW))).status).toBe(400);
    expect((await err(prepareInvoice(db, chain(), cfg, user, draft({ lines: [] }), NOW))).status).toBe(400);
    expect((await err(prepareInvoice(db, chain(), cfg, user, undefined as never, NOW))).status).toBe(400);
  });
});

describe("sendInvoice", () => {
  async function prepared(v: Awaited<ReturnType<typeof vendor>>, over: Partial<ComposerDraft> = {}) {
    const p = await prepareInvoice(db, chain(), cfg, v.user, draft(over), NOW);
    return { p, signature: await sign(v.account, p.document) };
  }

  it("saves a properly signed invoice once, and sending it again returns the same one", async () => {
    const v = await vendor();
    const { p, signature } = await prepared(v);
    const r = await sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature });
    expect(r).toEqual({ fingerprint: p.fingerprint, path: `/p/invoice/${p.fingerprint}`, duplicate: false });
    const again = await sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature });
    expect(again).toEqual({ fingerprint: p.fingerprint, path: `/p/invoice/${p.fingerprint}`, duplicate: true });
    const rows = await db.select().from(invoices).where(eq(invoices.fingerprint, p.fingerprint));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "verified", source: "link", seal: v.account.address.toLowerCase(), invoiceNumber: "0144" });
    expect(decodeSealedInvoice(rows[0]!.envelope).signature).toBe(signature);
  });

  it("remembers who was invoiced, once", async () => {
    const v = await vendor();
    const first = await prepared(v);
    await sendInvoice(db, chain(), cfg, v.user, { document: first.p.document, signature: first.signature });
    const second = await prepared(v, { invoiceNumber: "0145" });
    await sendInvoice(db, chain(), cfg, v.user, { document: second.p.document, signature: second.signature });
    expect(await listClients(db, v.user)).toMatchObject([{ name: "Acme Operations", vault: VAULT }]);
  });

  it("links the invoice to a Symbolon business when the payer is its Vault", async () => {
    const v = await vendor();
    const { p, signature } = await prepared(v);
    await sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature });
    // no business owns this Vault here, so it stays unlinked; slice 4 shows it in a business's inbox when one does
    expect((await db.select().from(invoices).where(eq(invoices.fingerprint, p.fingerprint)))[0]!.businessId).toBeNull();
  });

  it("stores nothing for a signature from the wrong key, and the real one can still be saved afterwards", async () => {
    const v = await vendor();
    const { p, signature } = await prepared(v);
    const stranger = privateKeyToAccount(generatePrivateKey());
    expect((await err(sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature: await signSealMessage(stranger, typedData(sealDomain(cfg.chainId, LEDGER), "Invoice", toInvoice(p.document))) }))).status).toBe(400);
    expect(await db.select().from(invoices).where(eq(invoices.fingerprint, p.fingerprint))).toHaveLength(0);
    expect((await sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature })).duplicate).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["not hex", "nope"],
    ["truncated", "0x1234"],
    ["all zeros", `0x${"00".repeat(65)}`],
  ])("refuses a %s signature and stores nothing", async (_n, signature) => {
    const v = await vendor();
    const { p } = await prepared(v);
    const e = await err(sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature }));
    expect(e.status).toBe(400);
    expect(await db.select().from(invoices).where(eq(invoices.fingerprint, p.fingerprint))).toHaveLength(0);
  });

  it("refuses a signature for a different document", async () => {
    const v = await vendor();
    const a = await prepared(v, { invoiceNumber: "0001" });
    const b = await prepared(v, { invoiceNumber: "0002", lines: [{ description: "Other", quantity: "2", unitPrice: "5" }] });
    expect((await err(sendInvoice(db, chain(), cfg, v.user, { document: b.p.document, signature: a.signature }))).status).toBe(400);
  });

  it("refuses a document changed after signing", async () => {
    const v = await vendor();
    const { p, signature } = await prepared(v);
    const tampered = { ...p.document, payout: { ...p.document.payout, address: "0x9999999999999999999999999999999999999999" } };
    expect((await err(sendInvoice(db, chain(), cfg, v.user, { document: tampered, signature }))).status).toBe(400);
    expect(await db.select().from(invoices).where(eq(invoices.fingerprint, p.fingerprint))).toHaveLength(0);
  });

  it("refuses an invoice signed for another ledger", async () => {
    const v = await vendor();
    const p = await prepareInvoice(db, chain(), cfg, v.user, draft(), NOW);
    const other = "0x4444444444444444444444444444444444444444";
    const signature = await sign(v.account, p.document, other);
    expect((await err(sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature }))).status).toBe(400);
  });

  it("refuses someone else's Seal, and a replay of another vendor's signed invoice", async () => {
    const a = await vendor();
    const b = await vendor();
    const { p, signature } = await prepared(a);
    expect((await err(sendInvoice(db, chain(), cfg, b.user, { document: p.document, signature }))).status).toBe(403);
    expect(await db.select().from(invoices).where(eq(invoices.fingerprint, p.fingerprint))).toHaveLength(0);
  });

  it("refuses a second invoice with the same number", async () => {
    const v = await vendor();
    const first = await prepared(v);
    await sendInvoice(db, chain(), cfg, v.user, { document: first.p.document, signature: first.signature });
    expect((await err(prepareInvoice(db, chain(), cfg, v.user, draft(), NOW))).status).toBe(409);
    // a hand-made second document with the same number is refused at send too
    const later = new Date(NOW.getTime() + 60_000);
    const p2 = await prepareInvoice(db, chain(), cfg, v.user, draft({ invoiceNumber: "0145" }), later);
    const doc = { ...p2.document, invoiceNumber: "0144" };
    const sig = await sign(v.account, doc);
    expect((await err(sendInvoice(db, chain(), cfg, v.user, { document: doc, signature: sig }))).status).toBe(409);
  });

  it("refuses an unparseable document", async () => {
    const v = await vendor();
    expect((await err(sendInvoice(db, chain(), cfg, v.user, { document: { nope: true }, signature: `0x${"11".repeat(65)}` }))).status).toBe(400);
    expect((await err(sendInvoice(db, chain(), cfg, v.user, { document: undefined, signature: `0x${"11".repeat(65)}` }))).status).toBe(400);
  });
});

describe("numbers, lists and detail", () => {
  it("suggests the next number at the same width", async () => {
    const v = await vendor();
    expect(await nextInvoiceNumber(db, v.account.address)).toBe("0001");
    for (const [num, at] of [["0143", 0], ["0144", 1]] as const) {
      const p = await prepareInvoice(db, chain(), cfg, v.user, draft({ invoiceNumber: num }), new Date(NOW.getTime() + at * 1000));
      await sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature: await sign(v.account, p.document) });
    }
    expect(await nextInvoiceNumber(db, v.account.address)).toBe("0145");
    const p = await prepareInvoice(db, chain(), cfg, v.user, draft({ invoiceNumber: "INV-99" }), NOW);
    await sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature: await sign(v.account, p.document) });
    // the highest number wins whatever its prefix: 144 > 99
    expect(await nextInvoiceNumber(db, v.account.address)).toBe("0145");
  });

  it("increments a fifteen-digit suffix exactly", async () => {
    const v = await vendor();
    const p = await prepareInvoice(db, chain(), cfg, v.user, draft({ invoiceNumber: "999999999999999" }), NOW);
    await sendInvoice(db, chain(), cfg, v.user, { document: p.document, signature: await sign(v.account, p.document) });
    expect(await nextInvoiceNumber(db, v.account.address)).toBe("1000000000000000");
  });

  it("lists only the Seal's own invoices, and shows one only to its Seal", async () => {
    const a = await vendor();
    const b = await vendor();
    const p = await prepareInvoice(db, chain(), cfg, a.user, draft(), NOW);
    await sendInvoice(db, chain(), cfg, a.user, { document: p.document, signature: await sign(a.account, p.document) });
    const rows = await listMyInvoices(db, a.user);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fingerprint: p.fingerprint, invoiceNumber: "0144", clientName: "Acme Operations", symbol: "USDC", total: "1600.000000", status: "verified" });
    expect(await listMyInvoices(db, b.user)).toEqual([]);
    expect((await myInvoice(db, a.user, p.fingerprint))?.row.fingerprint).toBe(p.fingerprint);
    expect(await myInvoice(db, b.user, p.fingerprint)).toBeNull();
    expect(await myInvoice(db, a.user, "0xnothash")).toBeNull();
  });
});
