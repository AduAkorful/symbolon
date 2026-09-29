import { isAddressEqual, type Hex } from "viem";

import type { Invoice } from "@symbolon/seal";

import type { PayeeTerms, PurchaseOrder } from "./types.js";

const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;
const DAY = 86_400n;

export interface MatchResult {
  kind: "invoice_only" | "two_way" | "three_way";
  ok: boolean;
  problems: string[];
}

/** Invoice ↔ PO ↔ delivery against the payee's terms (spec §5.3) */
export function matchInvoice(
  inv: Invoice,
  terms: PayeeTerms | undefined,
  po: PurchaseOrder | undefined,
  deliveryConfirmed: boolean,
  now: bigint,
): MatchResult {
  const problems: string[] = [];
  const needsPo = terms?.requirePo ?? false;
  const needsDelivery = terms?.requireDelivery ?? false;
  const kind = needsDelivery ? "three_way" : needsPo || inv.poRef !== ZERO_BYTES32 ? "two_way" : "invoice_only";

  if (!terms) problems.push("the vendor isn't a payee of this business yet");
  if (needsPo && inv.poRef === ZERO_BYTES32) problems.push("no purchase order cited");
  if (inv.poRef !== ZERO_BYTES32) {
    if (!po || !po.open) problems.push("the cited purchase order isn't open here");
    else {
      if (!isAddressEqual(po.seal, inv.seal)) problems.push("the purchase order belongs to another vendor");
      if (inv.amount > po.remaining) problems.push(`invoice ${inv.amount} exceeds the ${po.remaining} left on the PO`);
      if (now < po.releaseAfter) problems.push("the purchase order isn't released yet");
    }
  }
  if (needsDelivery && !deliveryConfirmed) problems.push("delivery not confirmed");
  return { kind, ok: problems.length === 0, problems };
}

export interface KnownInvoice {
  fingerprint: Hex;
  seal: string;
  invoiceNumber: string;
  amount: bigint;
  issuedAt: bigint;
}

export interface DuplicateFinding {
  kind: "exact" | "same_number" | "near";
  fingerprint: Hex;
  detail: string;
}

/** Duplicate screening (spec §11.5): exact duplicates never pay twice onchain; near-duplicates are held for a human */
export function findDuplicates(
  candidate: KnownInvoice,
  known: readonly KnownInvoice[],
  opts: { windowDays?: number; toleranceBps?: number } = {},
): DuplicateFinding[] {
  const window = BigInt(opts.windowDays ?? 14) * DAY;
  const tolerance = BigInt(opts.toleranceBps ?? 100);
  const findings: DuplicateFinding[] = [];
  for (const k of known) {
    if (k.seal.toLowerCase() !== candidate.seal.toLowerCase()) continue;
    if (k.fingerprint === candidate.fingerprint) {
      findings.push({ kind: "exact", fingerprint: k.fingerprint, detail: "the same sealed invoice" });
      continue;
    }
    if (k.invoiceNumber.trim().toLowerCase() === candidate.invoiceNumber.trim().toLowerCase()) {
      findings.push({ kind: "same_number", fingerprint: k.fingerprint, detail: `invoice number ${k.invoiceNumber} used before` });
      continue;
    }
    const diff = k.amount > candidate.amount ? k.amount - candidate.amount : candidate.amount - k.amount;
    const gap = k.issuedAt > candidate.issuedAt ? k.issuedAt - candidate.issuedAt : candidate.issuedAt - k.issuedAt;
    if (diff * 10_000n <= candidate.amount * tolerance && gap <= window) {
      findings.push({ kind: "near", fingerprint: k.fingerprint, detail: `similar amount issued ${gap / DAY} days apart` });
    }
  }
  return findings;
}
