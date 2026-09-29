import { and, desc, eq } from "drizzle-orm";
import { erc20Abi, isHex, type Hex, type PublicClient } from "viem";
import { receiveInvoice } from "@symbolon/core";
import { invoices, type Database } from "@symbolon/db";
import {
  SealError,
  decodeSealedInvoice,
  encodeSealedInvoice,
  fingerprint,
  parseDocument,
  sealDomain,
  toInvoice,
  typedDataJson,
  verifySealedInvoice,
  type InvoiceDocument,
} from "@symbolon/seal";
import { buildDocument, type ComposerDraft } from "./compose";
import { AuthError } from "./errors";
import type { ChainSettings } from "./business";
import type { SessionUser } from "./session";
import { requireMySeal, upsertClient } from "./vendor";

// Plan 05i, V2–V4, V8. Prepare builds what will be signed and writes nothing; send saves a signed envelope after checking it.

/** The next invoice number for a Seal: the highest number that ends in digits, plus one, at the same width ("0143" → "0144") */
function incrementDecimal(value: string): string {
  const digits = value.split("");
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    if (digits[i] !== "9") {
      digits[i] = String(Number(digits[i]) + 1);
      return digits.join("");
    }
    digits[i] = "0";
  }
  return `1${digits.join("")}`;
}

export async function nextInvoiceNumber(db: Database, seal: string): Promise<string> {
  const rows = await db.select({ n: invoices.invoiceNumber }).from(invoices).where(eq(invoices.seal, seal.toLowerCase()));
  let best: { value: string; width: number; prefix: string } | null = null;
  for (const { n } of rows) {
    const m = /^(.*?)(\d{1,15})$/.exec(n);
    if (!m) continue;
    const value = m[2]!;
    if (!best || value.length > best.value.length || (value.length === best.value.length && value > best.value)) best = { value, width: value.length, prefix: m[1]! };
  }
  if (!best) return "0001";
  return `${best.prefix}${incrementDecimal(best.value).padStart(best.width, "0")}`;
}

async function numberTaken(db: Database, seal: string, invoiceNumber: string, exceptFingerprint?: string): Promise<boolean> {
  const rows = await db.select({ fp: invoices.fingerprint }).from(invoices).where(and(eq(invoices.seal, seal.toLowerCase()), eq(invoices.invoiceNumber, invoiceNumber)));
  return rows.some((r) => r.fp !== exceptFingerprint);
}

export interface PreparedInvoice {
  document: InvoiceDocument;
  /** The exact payload for eth_signTypedData_v4 */
  typedData: string;
  fingerprint: Hex;
  chainId: number;
}

export async function prepareInvoice(
  db: Database,
  client: Pick<PublicClient, "readContract">,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id" | "wallet">,
  draft: ComposerDraft,
  now: Date = new Date(),
): Promise<PreparedInvoice> {
  const seal = await requireMySeal(db, user.id);
  if (typeof draft !== "object" || draft === null || typeof draft.client !== "object" || draft.client === null) throw new AuthError(400, "That invoice draft was malformed.");
  const { deployment, chainId } = cfg;
  if (typeof draft.currency !== "string" || (draft.currency !== "USDC" && draft.currency !== "EURC")) throw new AuthError(400, "Choose USDC or EURC.");
  const token = draft.currency === "USDC" ? deployment.tokens.usdc : deployment.tokens.eurc;

  let decimals: number;
  try {
    decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
  } catch {
    throw new AuthError(503, "Can't read the token from Arc right now, so the invoice can't be prepared. Try again in a moment.");
  }

  const document = buildDocument(draft, {
    now,
    chainId,
    seal,
    tokens: { USDC: deployment.tokens.usdc, EURC: deployment.tokens.eurc },
    decimals,
    payoutDomain: deployment.cctpDomain,
  });
  if (await numberTaken(db, seal.address, document.invoiceNumber)) throw new AuthError(409, `You already have an invoice numbered ${document.invoiceNumber}.`);

  const invoice = toInvoice(document);
  const domain = sealDomain(chainId, deployment.contracts.invoiceLedger);
  return { document, typedData: typedDataJson(domain, "Invoice", invoice), fingerprint: fingerprint(domain, invoice), chainId };
}

export interface SentInvoice {
  fingerprint: Hex;
  path: string;
  duplicate: boolean;
}

/**
 * V3. Saves a signed invoice: the signature must verify for this person's Seal on this chain and ledger, and nothing is stored
 * otherwise. Sending the same envelope again returns the same row.
 */
export async function sendInvoice(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  input: { document: unknown; signature: unknown },
): Promise<SentInvoice> {
  const seal = await requireMySeal(db, user.id);
  if (typeof input.signature !== "string" || !isHex(input.signature)) throw new AuthError(400, "The signature is missing or malformed.");
  let document: InvoiceDocument;
  try {
    document = parseDocument(input.document);
  } catch (e) {
    throw new AuthError(400, e instanceof SealError ? "That isn't a valid invoice document." : "That invoice couldn't be read.");
  }
  if (document.seal.toLowerCase() !== seal.address.toLowerCase()) throw new AuthError(403, "That invoice is for a different Seal than yours.");

  const ledger = cfg.deployment.contracts.invoiceLedger;
  const envelope = { v: 1 as const, chainId: cfg.chainId, ledger: ledger.toLowerCase(), document, signature: input.signature.toLowerCase() as Hex };

  // Check before storing anything: the intake stores rejected rows too, and a bad signature must never take a fingerprint's place
  const v = await verifySealedInvoice(envelope, { client, expected: { chainId: cfg.chainId, ledger } });
  if (!v.ok || !v.fingerprint) {
    const first = v.issues[0];
    throw new AuthError(400, first ? `The signature or invoice didn't check out: ${first.message}` : "The invoice didn't check out.");
  }
  if (await numberTaken(db, seal.address, document.invoiceNumber, v.fingerprint)) throw new AuthError(409, `You already have an invoice numbered ${document.invoiceNumber}.`);

  const r = await receiveInvoice(db, { chainId: cfg.chainId, ledger }, envelope, "link", { signatureClient: client });
  if (r.status !== "verified" || !r.fingerprint) throw new AuthError(400, "The invoice didn't check out.");
  // V5: remember who was invoiced. The invoice is already saved, so a client that can't be remembered never fails the send.
  await upsertClient(db, user, { name: document.payer.name, vault: document.payer.vault, email: document.payer.email }).catch((e: unknown) => {
    if (!(e instanceof AuthError)) throw e;
  });
  return { fingerprint: r.fingerprint, path: `/invoice/${r.fingerprint}`, duplicate: r.duplicate };
}

export interface InvoiceRow {
  fingerprint: string;
  invoiceNumber: string;
  clientName: string;
  symbol: string;
  total: string;
  dueDate: Date;
  status: string;
  receivedAt: Date;
}

const format = (raw: bigint, decimals: number) => {
  const s = raw.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
};

/** The Seal's own invoices, newest first, read for display from the stored envelopes */
export async function listMyInvoices(db: Database, user: Pick<SessionUser, "id">): Promise<InvoiceRow[]> {
  const seal = await requireMySeal(db, user.id);
  const rows = await db.select().from(invoices).where(eq(invoices.seal, seal.address)).orderBy(desc(invoices.receivedAt));
  return rows.map((r) => {
    let clientName = "—";
    let symbol = "";
    let decimals = 6;
    try {
      const d = decodeSealedInvoice(r.envelope).document;
      clientName = d.payer.name;
      symbol = d.currency.symbol;
      decimals = d.currency.decimals;
    } catch {
      // a stored row that no longer parses is listed without details, not hidden
    }
    return { fingerprint: r.fingerprint, invoiceNumber: r.invoiceNumber, clientName, symbol, total: format(r.total, decimals), dueDate: r.dueDate, status: r.status, receivedAt: r.receivedAt };
  });
}

/** One of the Seal's own invoices with its document; null when it isn't theirs (the same answer as unknown) */
export async function myInvoice(db: Database, user: Pick<SessionUser, "id">, fingerprint: string) {
  const seal = await requireMySeal(db, user.id);
  if (!/^0x[0-9a-f]{64}$/.test(fingerprint)) return null;
  const [r] = await db.select().from(invoices).where(and(eq(invoices.fingerprint, fingerprint), eq(invoices.seal, seal.address))).limit(1);
  if (!r) return null;
  try {
    return { row: r, sealed: decodeSealedInvoice(r.envelope), encoded: encodeSealedInvoice(decodeSealedInvoice(r.envelope)) };
  } catch {
    return null;
  }
}
