import { getAddress, isAddress } from "viem";
import { SealError, completeTotals, type InvoiceDocument } from "@symbolon/seal";
import { checkDocument, DOCUMENT_SCHEMA } from "@symbolon/seal";
import { BIDI_TEXT } from "../text-safety";
import { AuthError } from "./errors";
import { cleanLine } from "./vendor";

// Plan 05i, V2, V6, V7, V9: the composer's fields become the canonical document, on the server, with exact decimal arithmetic.
// The screen the person confirms renders this document; the wallet is asked to sign the invoice derived from it.

export interface ComposerDraft {
  client: { name: unknown; vault?: unknown; email?: unknown };
  currency: unknown; // "USDC" | "EURC"
  invoiceNumber: unknown;
  /** Days from now until it is due, 1 to 365 */
  dueDays: unknown;
  lines: unknown; // { description, quantity, unitPrice }[]
  /** Tax as a percentage of the subtotal, e.g. "20" or "7.5"; blank or "0" for none */
  taxPercent?: unknown;
  poNumber?: unknown;
  terms?: unknown;
  notes?: unknown;
  /** Up to three tiers: a discount percentage (under 10) if paid within some days */
  earlyPay?: unknown;
}

export interface ComposeContext {
  now: Date;
  chainId: number;
  seal: { address: string; displayName: string; legalName: string | null; website: string | null; payoutAddress: string | null };
  tokens: { USDC: string; EURC: string };
  /** Read from the token contract, never assumed */
  decimals: number;
  /** The registry's CCTP domain for this chain (Arc's own) */
  payoutDomain: number;
}

const DAY = 86_400;
export const MAX_LINES = 100;
export const MAX_EARLY_TIERS = 3;

const bad = (message: string): never => {
  throw new AuthError(400, message);
};

function percentToBps(value: unknown, what: string, max: number): number {
  const s = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return bad(`${what} is a percentage like 5 or 7.5 (up to two decimals).`);
  const [whole, frac = ""] = s.split(".");
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (bps > max) return bad(`${what} can't be more than ${max / 100}%.`);
  return bps;
}

function optionalBlock(value: unknown, what: string, max: number): string | undefined {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) return undefined;
  const s = typeof value === "string" ? value.replace(/\r\n?/g, "\n").normalize("NFC").trim() : "";
  if (s.length > max || /[^\P{Cc}\n]/u.test(s) || BIDI_TEXT.test(s)) return bad(`${what} is up to ${max} characters, without control characters.`);
  return s;
}

/** Builds the canonical document from the composer's fields. Throws a 400 with a plain reason for anything that isn't a valid invoice. */
export function buildDocument(draft: ComposerDraft, ctx: ComposeContext): InvoiceDocument {
  const issuedAt = Math.floor(ctx.now.getTime() / 1000);

  const symbol = draft.currency === "USDC" || draft.currency === "EURC" ? draft.currency : bad("Choose USDC or EURC.");
  const token = ctx.tokens[symbol];

  const dueDays = Number(draft.dueDays);
  if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) bad("Due in 1 to 365 days.");

  const c = draft.client;
  const clientName = cleanLine(c.name, "The client's name", 2, 200);
  const vaultText = typeof c.vault === "string" ? c.vault.trim() : "";
  const emailText = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!vaultText && !emailText) bad("Give the client's Vault address or an email address.");
  if (vaultText && !isAddress(vaultText)) bad("That isn't a valid Vault address.");
  const payer: InvoiceDocument["payer"] = { name: clientName, ...(vaultText ? { vault: getAddress(vaultText).toLowerCase() } : {}), ...(emailText ? { email: emailText } : {}) };

  if (!Array.isArray(draft.lines) || draft.lines.length === 0) bad("Add at least one line.");
  const rawLines = draft.lines as unknown[];
  if (rawLines.length > MAX_LINES) bad(`An invoice can have up to ${MAX_LINES} lines.`);
  const lineItems = rawLines.map((l, i) => {
    const o = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
    return {
      description: optionalBlock(o.description, `Line ${i + 1}'s description`, 1000) ?? bad(`Line ${i + 1} needs a description.`),
      quantity: typeof o.quantity === "string" ? o.quantity.trim() : bad(`Line ${i + 1} needs a quantity.`),
      unitPrice: typeof o.unitPrice === "string" ? o.unitPrice.trim() : bad(`Line ${i + 1} needs a price.`),
    };
  });

  const taxText = typeof draft.taxPercent === "string" ? draft.taxPercent.trim() : "";
  const taxes = taxText && Number(taxText) !== 0 ? [{ label: "Tax", rateBps: percentToBps(taxText, "Tax", 10_000) }] : [];

  const tiersIn = draft.earlyPay === undefined || draft.earlyPay === null ? [] : draft.earlyPay;
  if (!Array.isArray(tiersIn) || tiersIn.length > MAX_EARLY_TIERS) return bad(`Early Pay has up to ${MAX_EARLY_TIERS} tiers.`);
  const earlyPay = tiersIn.map((t, i) => {
    const o = (typeof t === "object" && t !== null ? t : {}) as Record<string, unknown>;
    const days = Number(o.days);
    if (!Number.isInteger(days) || days < 1 || days >= dueDays) bad(`Early Pay tier ${i + 1} must be paid within a number of days before the due date.`);
    const discountBps = percentToBps(o.percent, `Early Pay tier ${i + 1}'s discount`, 999);
    if (discountBps === 0) bad(`Early Pay tier ${i + 1} needs a discount above 0%.`);
    return { payBy: issuedAt + days * DAY, discountBps };
  });

  const poNumber = optionalBlock(draft.poNumber, "The PO number", 100);
  const terms = optionalBlock(draft.terms, "The terms", 2000);
  const notes = optionalBlock(draft.notes, "The notes", 4000);

  let doc: InvoiceDocument;
  try {
    doc = completeTotals({
      schema: DOCUMENT_SCHEMA,
      seal: ctx.seal.address.toLowerCase(),
      vendor: {
        name: ctx.seal.displayName,
        ...(ctx.seal.legalName ? { legalName: ctx.seal.legalName } : {}),
        ...(ctx.seal.website ? { website: ctx.seal.website } : {}),
      },
      payer,
      invoiceNumber: cleanLine(draft.invoiceNumber, "The invoice number", 1, 100),
      issuedAt,
      dueDate: issuedAt + dueDays * DAY,
      currency: { chainId: ctx.chainId, token: token.toLowerCase(), symbol, decimals: ctx.decimals },
      lineItems,
      taxes,
      discounts: [],
      ...(poNumber ? { poNumber } : {}),
      ...(terms ? { terms } : {}),
      ...(notes ? { notes } : {}),
      payout: { address: (ctx.seal.payoutAddress ?? ctx.seal.address).toLowerCase(), domain: ctx.payoutDomain },
      earlyPay,
      attachments: [],
    } as never);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    if (e instanceof SealError) throw new AuthError(400, readable(e));
    throw new AuthError(400, "That isn't a valid invoice.");
  }
  const issues = checkDocument(doc);
  if (issues.length > 0) throw new AuthError(400, issues[0]!.message);
  return doc;
}

/** A SealError's message plus the first issue's detail, in one plain sentence */
function readable(e: SealError): string {
  const first = e.issues[0];
  return first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : e.message;
}
