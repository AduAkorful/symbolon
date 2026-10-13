import type { InvoiceStatus } from "@symbolon/chain";
import type { Invoice, Verification } from "@symbolon/seal";
import { ApprovalLevel, checkPayment, type VaultFacts } from "@symbolon/steward";

import { describeRule, vendorBlocker, type Blocker } from "../blockers";
import type { EvidenceRow } from "./match-view";

/**
 * Everything that would stop this invoice being paid today, for the invoice page (plan 05zj C, SYM-06). The Vault's own rules come
 * from the Steward's mirror (`checkPayment`), so the list can't contradict the Vault; the business-side reasons (the vendor isn't
 * verified, a possible duplicate) come from what the app itself knows. An invoice that can't be read from the chain says so rather
 * than showing an empty list, because "nothing is stopping it" must never be a guess.
 */
export function blockersForInvoice(input: {
  verification: Verification;
  trust?: "verified" | "new_vendor" | "blocked" | "failed";
  facts?: VaultFacts;
  ledger?: InvoiceStatus;
  evidenceRows: EvidenceRow[];
}): { blockers: Blocker[]; settled: boolean } {
  const invoice: Invoice | undefined = input.verification.invoice;
  const blockers: Blocker[] = [];
  if (!invoice) return { blockers, settled: false };
  const settled = Boolean(input.ledger?.paid || input.ledger?.cancelled);
  if (settled) return { blockers, settled };

  const vendor = vendorBlocker(input.trust ?? "failed", invoice.seal);
  if (vendor) blockers.push(vendor);

  if (!input.facts) {
    blockers.push({
      rule: "ChainUnreadable",
      kind: "info",
      title: "Can't read the Vault right now",
      detail: "The checks that depend on Arc couldn't be made, so this list may be incomplete. Reload in a moment.",
    });
  } else {
    const remaining = input.ledger?.seen ? input.ledger.remaining : invoice.amount;
    const check = checkPayment(input.facts, { invoice, credit: remaining, paid: remaining, maxFee: 0n, approvalHeld: ApprovalLevel.None });
    const ctx = { seal: invoice.seal, now: input.facts.now, ...(input.facts.payee ? { activeAt: input.facts.payee.activeAt } : {}) };
    for (const failure of check.failures) {
      // "not a payee" repeats "not verified yet": one reason, with the step that fixes it
      if (failure.rule === "UnknownPayee" && vendor?.rule === "VendorNotVerified") continue;
      blockers.push(describeRule(failure, ctx));
    }
  }

  const duplicate = input.evidenceRows.find((r) => r.label === "Duplicates" && r.state === "blocks");
  if (duplicate) {
    blockers.push({ rule: "PossibleDuplicate", kind: "action", title: "This may be a duplicate", detail: duplicate.value });
  }
  return { blockers, settled };
}
