// Seeds a LOCAL development database for the UI audit (plan 05zb, Q5) and writes tokens.json for run.mjs.
//
//   pnpm --filter @symbolon/app exec tsx scripts/ui-audit/seed.mts --vault 0x… [--steward 0x…] [--data .data/pglite] [--out scripts/ui-audit/tokens.json]
//
// Stop the dev server first: PGlite is a single-process database. Nothing here touches Privy, Circle or the chain; sessions are
// rows made directly in the database, exactly as the app's own tests make them. `--vault` must be a Vault that exists on the
// chain the app is configured for (pages read it live); it is never typed into this file. Running it again keeps the data it
// made and only issues new sessions. It refuses to run against anything but a local PGlite folder.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createLocalDb, invoices, members, notifications, payees, seals, sessions, stewardRuns, users } from "@symbolon/db";
import { completeTotals, encodeSealedInvoice, sealInvoice } from "@symbolon/seal";
import { and, eq } from "drizzle-orm";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const dataDir = resolve(arg("data") ?? ".data/pglite");
const outFile = resolve(arg("out") ?? "scripts/ui-audit/tokens.json");
if (/^[a-z]+:\/\//i.test(dataDir)) throw new Error("The audit seed only writes to a local PGlite folder.");

const OWNER_EMAIL = "owner@acme.example";
const VENDOR_EMAIL = "accounts@mueller.example";
const BUSINESS = "Acme Operations";
const LONG_NAME = "Müller & Söhne Gesellschaft für Industrielle Dienstleistungen und Wartung mbH";

const deployment = getDeployment(arcTestnet.id);
const db = await createLocalDb(dataDir);
const randomWallet = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase();

async function user(email: string, name?: string, wallet = randomWallet()) {
  const [found] = await db.select().from(users).where(eq(users.email, email));
  if (found) return { row: found, created: false };
  const [row] = await db.insert(users).values({ email, displayName: name, wallet }).returning();
  return { row: row!, created: true };
}

const owner = await user(OWNER_EMAIL, "Acme Owner");
const vendor = await user(VENDOR_EMAIL);

let [biz] = await db.select().from(businesses).where(eq(businesses.name, BUSINESS)).limit(1);
if (!biz) {
  const vault = arg("vault");
  if (!vault || !/^0x[0-9a-fA-F]{40}$/.test(vault)) throw new Error("Pass --vault 0x… (a Vault that exists on the configured chain).");
  const steward = arg("steward");
  if (steward && !/^0x[0-9a-fA-F]{40}$/.test(steward)) throw new Error("--steward is not an address.");
  [biz] = await db.insert(businesses).values({ name: BUSINESS, chainId: arcTestnet.id, vault: vault.toLowerCase(), stewardWallet: (steward ?? randomWallet()).toLowerCase(), stewardMode: "assist" }).returning();
}
if (owner.created) await db.insert(members).values({ businessId: biz!.id, userId: owner.row.id, role: "owner" });

if (vendor.created) {
  const key = privateKeyToAccount(generatePrivateKey());
  const seal = key.address.toLowerCase();
  await db.update(users).set({ wallet: seal }).where(eq(users.id, vendor.row.id));
  await db.insert(seals).values({ address: seal, userId: vendor.row.id, handle: "mueller-soehne", displayName: LONG_NAME, legalName: LONG_NAME, website: "https://mueller.example" });
  await db.insert(payees).values({ businessId: biz!.id, seal, status: "verified", verificationMethod: "invitation", verifiedAt: new Date(), verifiedBy: owner.row.id });

  const VAULT = biz!.vault!;
  const day = 86_400;
  const now = Math.floor(Date.now() / 1000);
  const units = (amount: string) => BigInt(Math.round(Number(amount) * 1e6));
  const invoice = async (n: number, total: string, status: string, due: number, o: { symbol?: "USDC" | "EURC"; number?: string; desc?: string } = {}) => {
    const symbol = o.symbol ?? "USDC";
    const token = (symbol === "EURC" ? deployment.tokens.eurc : deployment.tokens.usdc).toLowerCase();
    const number = o.number ?? `E-${n}`;
    const document = completeTotals({
      schema: "symbolon.invoice.v1", seal, vendor: { name: LONG_NAME }, payer: { name: BUSINESS, vault: VAULT },
      invoiceNumber: number, issuedAt: now - 30 * day, dueDate: now + due * day,
      currency: { chainId: arcTestnet.id, token, symbol, decimals: 6 },
      lineItems: [{ description: o.desc ?? `Wartung Anlage ${n}`, quantity: "1", unitPrice: total }], taxes: [], discounts: [],
      payout: { address: seal, domain: 26 }, earlyPay: [], attachments: [],
    } as never);
    const { sealed, fingerprint } = await sealInvoice({ signer: key, chainId: arcTestnet.id, ledger: deployment.contracts.invoiceLedger, document });
    await db.insert(invoices).values({
      businessId: biz!.id, fingerprint, chainId: arcTestnet.id, ledger: deployment.contracts.invoiceLedger, seal,
      payerRef: `0x${"00".repeat(12)}${VAULT.slice(2)}`, source: "link", dueDate: new Date((now + due * day) * 1000), token, invoiceNumber: number,
      envelope: encodeSealedInvoice(sealed), total: units(total), credited: status === "paid" ? units(total) : 0n, receivedAt: new Date(), status: status as never,
    } as never);
  };
  // the awkward ones first: a long name, a long invoice number, a long line description, EURC
  await invoice(1, "14250.5", "awaiting_approval", 12, { symbol: "EURC", number: "INV-2026-ÄÖÜ-0000000000000042-REVISED-FINAL", desc: "Quarterly preventive maintenance of the industrial cooling installation, including replacement parts, travel, and out-of-hours emergency callouts" });
  const statuses = ["verified", "paid", "scheduled", "held", "received", "awaiting_approval", "partially_paid", "cancelled"];
  for (let i = 2; i < 24; i++) await invoice(i, String(100 + i * 137), statuses[i % statuses.length]!, (i % 30) - 6);

  // a run that has been "running" for a week: the stalled state
  await db.insert(stewardRuns).values({ businessId: biz!.id, trigger: "manual", mode: "shadow", status: "running", startedAt: new Date(Date.now() - 7 * 86_400_000), summary: {} });
  for (const [email, name, role] of [
    ["ravi.approver@acme.example", "Ravi Approver With A Very Long Display Name Indeed", "approver"],
    ["lena.requester@acme.example", "Lena", "requester"],
    ["viewer@acme.example", "Sam Viewer", "viewer"],
  ] as const) {
    const member = await user(email, name);
    await db.insert(members).values({ businessId: biz!.id, userId: member.row.id, role });
  }
  for (let i = 0; i < 6; i++) {
    await db.insert(notifications).values({ userId: owner.row.id, kind: i % 2 ? "invoice_paid" : "approval_needed", subject: null, body: { invoiceNumber: `E-${i}`, vendor: LONG_NAME, amount: "14250.50" }, dedupeKey: `audit-${i}` });
  }
}

async function session(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.insert(sessions).values({ userId, tokenHash: createHash("sha256").update(token).digest("hex"), method: "privy", createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 30 * 86_400_000) });
  return token;
}
const [anInvoice] = await db.select({ fingerprint: invoices.fingerprint }).from(invoices).where(and(eq(invoices.businessId, biz!.id), eq(invoices.invoiceNumber, "E-2"))).limit(1);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ owner: await session(owner.row.id), vendor: await session(vendor.row.id), vendorFingerprint: anInvoice?.fingerprint ?? null }, null, 2));
console.log(`${owner.created ? "seeded" : "already seeded; new sessions issued"} in ${dataDir}; tokens written to ${outFile}`);
process.exit(0);
