import { isAddressEqual } from "viem";
import type { InvoiceStatus } from "@symbolon/chain";
import type { MatchResult, DuplicateFinding, PayeeTerms, PurchaseOrder, VaultFacts } from "@symbolon/steward";
import { formatAmount, type Verification, type Invoice } from "@symbolon/seal";
import { showAmount } from "../format";

const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const BLOCKED_RISK = 3;

export type EvidenceState = "holds" | "missing" | "blocks" | "info";

/** The match engine reports problems as lower-case fragments; a row on screen starts with a capital */
const sentence = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

export interface EvidenceRow {
  label: string;
  state: EvidenceState;
  value: string;
  source: string;
}

export interface MatchViewInput {
  verification: Verification;
  invoice: Invoice;
  trust: "verified" | "new_vendor" | "blocked" | "failed";
  facts?: VaultFacts;
  ledger?: InvoiceStatus;
  match?: MatchResult;
  duplicates?: DuplicateFinding[];
  payeeTerms?: PayeeTerms;
  purchaseOrder?: PurchaseOrder;
  /** DB-side delivery row for this invoice, if it exists */
  dbDelivery?: {
    state: string; // "confirmed" | "rejected"
    reason?: string | null;
    txHash?: string | null;
  };
  /** DB-side PO row for this invoice's cited poRef, if it was loaded */
  dbPo?: {
    poNumber: string;
    open: boolean; // from live lens read; false = closed or lens failed
    remainingRaw?: string | null; // raw bigint string from lens
    releaseAfter?: Date | null; // from DB row
    openTx?: string | null;
    closedAt?: Date | null;
  };
}

/** Pure, conservative evidence composition. Any unreadable or missing guard prevents the matched state. */
export function evidenceFor(input: MatchViewInput): { rows: EvidenceRow[]; matched: boolean } {
  const rows: EvidenceRow[] = [];
  const add = (label: string, state: EvidenceState, value: string, source: string) => rows.push({ label, state, value, source });

  add("Sealed invoice", input.verification.ok ? "holds" : "blocks", input.verification.ok ? "Signature and document check out" : "The signature or document does not check out", "Seal verification");
  add(
    "Vendor trust",
    input.trust === "verified" ? "holds" : input.trust === "blocked" ? "blocks" : input.trust === "new_vendor" ? "missing" : "blocks",
    input.trust === "verified" ? "Verified for this business" : input.trust === "blocked" ? "This Seal is blocked" : input.trust === "new_vendor" ? "A first-contact check is still needed" : "The stored envelope failed verification",
    "Business records",
  );

  if (!input.facts) {
    add("Vault and ledger reads", "blocks", "Can't confirm the onchain facts right now", "Arc");
  } else {
    add("Vault", input.facts.paused ? "blocks" : "holds", input.facts.paused ? "Payments are paused" : "Active", "VaultLens");
    add("Supported token", input.facts.isSupportedToken(input.invoice.token) ? "holds" : "blocks", input.facts.isSupportedToken(input.invoice.token) ? "Supported by this Vault" : "This Vault does not support the invoice token", "VaultLens");
    const payee = input.facts.payee;
    if (!payee?.exists) {
      add("Payee onchain", "missing", "The Seal is not an onchain payee", "VaultLens");
      add("Payee payout", "blocks", "Can't compare the invoice payout with an onchain payee", "VaultLens");
      add("Payee active", "blocks", "Can't confirm an active onchain payee", "VaultLens");
    } else {
      add("Payee onchain", "holds", "Payee exists", "VaultLens");
      const payoutMatches = isAddressEqual(payee.payout, input.invoice.payoutAddress) && payee.payoutDomain === input.invoice.payoutDomain;
      add("Payee payout", payoutMatches ? "holds" : "blocks", payoutMatches ? "Payout and domain match the sealed invoice" : "Payout or domain differs from the sealed invoice", "VaultLens");
      const active = payee.activeAt <= input.facts.now && (payee.retireAt === 0n || input.facts.now < payee.retireAt);
      add("Payee active", active ? "holds" : "blocks", active ? "Active now" : "Not active at this chain time", "VaultLens");
    }

    if (!payee?.exists || payee.risk === BLOCKED_RISK) {
      add("Screening", payee?.risk === BLOCKED_RISK ? "blocks" : "missing", payee?.risk === BLOCKED_RISK ? "Onchain screening blocks this payee" : "No onchain screening record", "VaultLens");
    } else if (input.facts.policy.screeningMaxAge === 0n) {
      // The Vault treats a max age of zero as "screening isn't required" (SymbolonVault._checkPayee); the row must say the same
      add("Screening", "info", "This Vault's policy doesn't require screening", "VaultLens");
    } else {
      const age = input.facts.now >= payee.screenedAt ? input.facts.now - payee.screenedAt : input.facts.policy.screeningMaxAge + 1n;
      const fresh = payee.screenedAt !== 0n && age <= input.facts.policy.screeningMaxAge;
      add("Screening", fresh ? "holds" : "missing", fresh ? "Screening is current" : "Screening is missing or stale", "VaultLens");
    }

    const terms = input.payeeTerms ?? payee?.terms;
    const poRequired = terms?.requirePo ?? input.invoice.poRef !== ZERO_BYTES32;
    const citedPo = input.invoice.poRef !== ZERO_BYTES32;
    const poProblems = input.match?.problems.filter((p) => p.includes("purchase order") || p.includes("PO")) ?? [];

    if (!poRequired && !citedPo) {
      add("Purchase order", "info", "No purchase order required", "Policy mirror");
    } else if (input.dbPo) {
      // We have a DB record: show the number and real state
      const po = input.dbPo;
      if (po.closedAt) {
        add("Purchase order", "missing", `Cites PO ${po.poNumber} · closed ${po.closedAt.toISOString().slice(0, 10)}`, "Orders · Vault");
      } else if (!po.open) {
        add("Purchase order", "blocks", `Cites PO ${po.poNumber} · can't confirm status right now`, "Orders · Vault");
      } else {
        const rem = po.remainingRaw ? ` · ${po.remainingRaw} left` : "";
        const rel = po.releaseAfter ? ` · not before ${po.releaseAfter.toISOString().slice(0, 10)}` : "";
        add(
          "Purchase order",
          poProblems.length === 0 ? "holds" : "missing",
          `Cites PO ${po.poNumber} · open${rem}${rel}`,
          po.openTx ? `tx ${po.openTx.slice(0, 10)}…` : "Orders",
        );
      }
    } else if (citedPo && !input.match) {
      add("Purchase order", "blocks", "Invoice cites a PO but the status can't be confirmed right now", "Policy mirror");
    } else if (citedPo && input.match) {
      add("Purchase order", poProblems.length === 0 ? "holds" : "missing", poProblems.length === 0 ? "Required purchase-order checks hold" : sentence(poProblems.join("; ")), "Policy mirror");
    } else if (!input.match) {
      add("Purchase order", "blocks", "Can't confirm the purchase-order rules right now", "Policy mirror");
    } else {
      add("Purchase order", poProblems.length === 0 ? "holds" : "missing", poProblems.length === 0 ? "Required purchase-order checks hold" : sentence(poProblems.join("; ")), "Policy mirror");
    }

    const deliveryRequired = terms?.requireDelivery ?? false;
    const deliveryProblems = input.match?.problems.filter((p) => p.includes("delivery")) ?? [];

    if (input.dbDelivery) {
      // We have a DB record: show the actual outcome
      if (input.dbDelivery.state === "confirmed") {
        add(
          "Delivery",
          "holds",
          `Delivery confirmed${input.dbDelivery.txHash ? ` · tx ${input.dbDelivery.txHash.slice(0, 10)}…` : ""}`,
          "Orders · Vault",
        );
      } else {
        add(
          "Delivery",
          "missing",
          `Delivery rejected: ${input.dbDelivery.reason ?? "no reason recorded"}`,
          "Orders · Vault",
        );
      }
    } else if (!deliveryRequired) {
      add("Delivery", "info", "Delivery confirmation is not required", "Policy mirror");
    } else if (!input.match) {
      add("Delivery", "blocks", "Can't confirm the delivery rules right now", "Policy mirror");
    } else {
      add("Delivery", deliveryProblems.length === 0 ? "holds" : "missing", deliveryProblems.length === 0 ? "Delivery confirmed" : sentence(deliveryProblems.join("; ")), "VaultLens / policy mirror");
    }

    if (input.match && !input.match.ok) {
      add("Policy match", "blocks", sentence(input.match.problems.join("; ")) || "The policy match did not hold", "Policy mirror");
    }
  }

  if (!input.ledger) add("Ledger", "blocks", "Can't confirm payment state", "InvoiceLedger");
  else if (input.ledger.cancelled) add("Ledger", "blocks", "Cancelled onchain", "InvoiceLedger");
  else if (input.ledger.paid) add("Ledger", "info", "Already paid onchain", "InvoiceLedger");
  else add("Ledger", "holds", input.ledger.seen ? `Remaining to pay: ${showAmount(formatAmount(input.ledger.remaining, 6))}` : "Not settled yet", "InvoiceLedger");

  if (input.duplicates?.length) add("Duplicates", "blocks", input.duplicates.map((d) => d.detail).join("; "), "Duplicate screening");
  else add("Duplicates", "holds", "No duplicate found in the current inbox", "Duplicate screening");

  const matched = rows.every((r) => r.state === "holds" || r.state === "info") && Boolean(input.verification.ok) && input.trust === "verified" && input.ledger?.paid !== true;
  return { rows, matched };
}
