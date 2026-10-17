import "server-only";
import { describeRule } from "../blockers";

import { formatAmount } from "@symbolon/seal";
import { formatDateTime, showMoney } from "../format";
import { usd } from "./policy-text";

export interface DecisionSummary {
  sentence: string;
  explanation?: string;
}

/** What each action the app records is called to a person. A kind missing here still gets a readable name from `humanizeKind`. */
const RECORDED_ACTIONS: Record<string, string> = {
  accounting_reconciliation: "Compared the invoice records with the ledger",
  approval_needed: "Asked for an approval",
  block_seal: "Blocked a vendor",
  unblock_seal: "Unblocked a vendor",
  buffer_changed: "Changed the cash buffer",
  business_renamed: "Renamed the business",
  change_applied: "Applied a queued change",
  change_cancelled: "Cancelled a queued change",
  change_queued: "Queued a change to the Vault's rules",
  counter_sent: "Sent a counter-offer on Early Pay",
  offer_countered: "Countered an Early Pay offer",
  offer_declined: "Declined an Early Pay offer",
  early_pay_changed: "Changed Early Pay settings",
  "settings:early_pay": "Changed Early Pay settings",
  "settings:buffer": "Changed the cash buffer",
  credit_note: "Applied a credit note",
  invoice_cancelled: "Cancelled an invoice",
  deposit_confirmed: "Added funds to the Vault",
  eurc_conversion: "Converted USDC to EURC",
  export_created: "Created an accounting export",
  member_removed: "Removed a team member",
  member_role_changed: "Changed a team member's role",
  payout_change: "A vendor asked to change where they get paid",
  payout_change_cancelled: "A payout change was cancelled",
  payout_change_confirmed: "Confirmed a vendor's new payout address",
  payout_change_rejected: "Rejected a vendor's new payout address",
  screening_recorded: "Recorded a compliance screening",
  seal_rotation: "A vendor rotated their Seal",
  set_approver: "Changed who can approve payments",
  set_requester: "Changed who can request payments",
  set_auto_update: "Changed automatic Vault updates",
  set_budget: "Changed a budget",
  set_policy: "Changed the Vault's policy",
  set_reserve_policy: "Changed the reserve policy",
  set_screener: "Changed who can record screenings",
  set_steward: "Changed the Steward",
  set_supported_token: "Changed which currencies the Vault pays in",
  steward_run_failed: "A Steward run failed",
  team_invitation_accepted: "A team invitation was accepted",
  team_invitation_created: "Invited someone to the team",
  team_invitation_revoked: "Withdrew a team invitation",
  unsigned_ask_sealed: "Asked a vendor to send a sealed invoice",
  unsigned_bill: "Held an unsigned bill",
  update_payee_terms: "Changed a vendor's payment terms",
  upgrade_applied: "Applied a Vault upgrade",
  upgrade_cancelled: "Cancelled a Vault upgrade",
  upgrade_prepared: "Prepared a Vault upgrade",
  upgrade_scheduled: "Scheduled a Vault upgrade",
  vendor_code_requested: "Requested a verification code from a vendor",
  vendor_invitation_created: "Invited a vendor",
  vendor_invitation_revoked: "Withdrew a vendor invitation",
  vendor_verification_awaiting_second: "A vendor's verification needs a second person",
  verification_awaiting_second: "A verification needs a second person",
  vendor_verification_expired: "A vendor verification expired",
  withdrawn: "Withdrew funds from the Vault",
};

/** "vendor_code_requested" → "Vendor code requested": the fallback for a kind the table doesn't know, so no code word reaches a screen */
export function humanizeKind(kind: string): string {
  const words = kind.replace(/[_:-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "A change was recorded";
}

/**
 * Pure function deriving a single plain English sentence from a decision record's own fields (S14).
 * Handles all core Steward kinds (pay, hold, schedule, reject, skip, refuse, request_approval, tx, sweep, redeem)
 * and app-level actions (steward_mode_changed, steward_fees_funded, payee_added, po_opened, po_closed,
 * delivery_confirmed, delivery_rejected).
 */
/** The vendor's signed offer the Steward looked at and why it wasn't taken, said first (plan 05zu 3.1, 3.2) */
function considered(record: Record<string, unknown>): string {
  const options = Array.isArray(record.options) ? (record.options as { kind?: unknown; discountBps?: unknown; reasons?: unknown }[]) : [];
  // a signed offer is said first; with none, the Early Pay tiers written into the invoice itself (QA STW-4, STW-6)
  const signed = options.filter((o) => o.kind === "offer" && typeof o.discountBps === "number");
  const tiers = options.filter((o) => o.kind === "tier" && typeof o.discountBps === "number" && Number(o.discountBps) > 0);
  const offers = signed.length > 0 ? signed : tiers;
  if (offers.length === 0) return "";
  const what = signed.length > 0 ? "offer" : "Early Pay term in the invoice";
  const best = offers.sort((a, b) => Number(b.discountBps) - Number(a.discountBps))[0]!;
  const reasons = Array.isArray(best.reasons) ? (best.reasons as string[]) : [];
  const plain = (r: string) =>
    /annualized/.test(r) ? "its return is below your minimum spread over the reserve yield"
    : /forecast buffer/.test(r) ? "paying early would take cash below your buffer"
    : /cap on cash/.test(r) ? "it would go over your cap on early payments"
    : /expired/.test(r) ? "the offer has expired"
    : /off for this business/.test(r) ? "Early Pay is off for this business"
    : /already due/.test(r) ? "it is already due"
    : r;
  const pct = (Number(best.discountBps) / 100).toFixed(2).replace(/\.?0+$/, "");
  if (reasons.length === 0) return `Considered the ${pct}% ${what}. `;
  return `Considered the ${pct}% ${what}, not taken: ${plain(reasons[0]!)}. `;
}

/** What the page reading a decision knows now, so a stored decision isn't shown as if it were still true (QA retest 18) */
export interface DecisionNow {
  /** Tokens the Vault pays in now, lowercased; a stored "doesn't accept this currency" for one of them has cleared since */
  supportedTokens?: ReadonlySet<string>;
  /** Lending vaults, lowercased; a transfer from one into the Vault is cash coming back from lending, not a deposit */
  lendingVenues?: ReadonlySet<string>;
}

export function summarizeDecision(record: Record<string, unknown>, now: DecisionNow = {}): DecisionSummary {
  const s = summarizeRecord(record, now);
  const tidy = (t: string) => tidySignOff(tidyMoney(t));
  return { ...s, sentence: tidy(s.sentence), ...(s.explanation ? { explanation: tidy(s.explanation) } : {}) };
}

/**
 * Older records (and the model's wording of them) say a payment "requires an approver's sign-off", though an owner may always
 * sign too (QA UI-2, UI-7). Only the words shown are changed; the stored record and its hash are untouched.
 */
export function tidySignOff(text: string): string {
  return text.replace(/\b(a|an) approver[’']s sign-off\b/gi, (_m, article: string) => `${article[0] === "A" ? "A" : "a"} sign-off from an approver or the owner`);
}

/** "212.6 USDC" and "212.600000 EURC" in prose (the model's wording included) become "$212.60" and "€212.60", as everywhere else */
export function tidyMoney(text: string): string {
  return text.replace(/(?<![\d.,])(\d[\d,]*(?:\.\d+)?)\s?(USDC|EURC)\b/g, (_m, amount: string, symbol: string) => showMoney(amount.replace(/,/g, ""), symbol));
}

/** "15 Oct, 17:07 UTC" from the record's own time, or "" when it has none */
function recordedAt(record: Record<string, unknown>): string {
  const at = typeof record.at === "string" ? new Date(record.at) : null;
  return at && !Number.isNaN(at.getTime()) ? formatDateTime(at) : "";
}

/** The token a stored UnsupportedToken failure names ("0x… isn't a payment token of this Vault"), lowercased */
function unsupportedTokenOf(b: { rule: string; detail: string }): string | null {
  if (b.rule !== "UnsupportedToken") return null;
  const m = /0x[0-9a-fA-F]{40}/.exec(b.detail ?? "");
  return m ? m[0].toLowerCase() : null;
}

/** A transfer into the Vault that came back from a lending vault (the Steward's or the owner's redeem), not a deposit */
export function isLendingReturn(record: Record<string, unknown>, venues?: ReadonlySet<string>): boolean {
  const inputs = (record.inputs as Record<string, unknown> | undefined) ?? {};
  if (inputs.fromLending === true) return true;
  const from = typeof inputs.from === "string" ? inputs.from.toLowerCase() : "";
  return Boolean(from && venues?.has(from));
}

function summarizeRecord(record: Record<string, unknown>, now: DecisionNow = {}): DecisionSummary {
  const kind = String(record.kind ?? "");
  const outcome = String(record.outcome ?? "");
  const rule = String(record.rule ?? "");
  const inputs = (record.inputs as Record<string, unknown> | undefined) ?? {};
  const explanation = typeof record.explanation === "string" ? record.explanation : undefined;

  switch (kind) {
    // a queued change names what it changes and when it can be applied (QA REL4-6)
    case "change_queued": {
      const summary = (inputs.summary as { title?: unknown } | undefined) ?? {};
      const title = typeof summary.title === "string" ? summary.title : "";
      const eta = typeof inputs.eta === "string" ? new Date(inputs.eta) : null;
      const when = eta && !Number.isNaN(eta.getTime()) ? `, ready to apply from ${formatDateTime(eta)}` : "";
      return { sentence: title ? `Queued a change: ${title}${when}` : `Queued a change to the Vault's rules${when}`, explanation };
    }

    case "pay": {
      const amount = inputs.paid ?? inputs.amount;
      const amountStr = typeof amount === "string" ? usd(BigInt(amount)) : "";
      if (outcome === "paid") {
        return { sentence: amountStr ? `Paid ${amountStr} on Arc` : "Payment sent on Arc", explanation };
      }
      if (outcome === "proposed") {
        return { sentence: amountStr ? `Proposed paying ${amountStr}` : "Proposed payment", explanation };
      }
      return { sentence: `Payment evaluated (${outcome})`, explanation };
    }

    case "hold": {
      return { sentence: rule ? `Held: ${rule}` : "Held for review", explanation };
    }

    case "schedule": {
      // since plan 05zj C a scheduled decision records the Vault rules that would stop a payment today
      // The blockers are what stood in the way when the decision was made, not now: "today" read as current long after it wasn't
      // (QA retest 18: a USDC invoice's decision said the Vault didn't accept its currency while its page said nothing was in the
      // way). They are labelled with the decision's own time, and a currency the Vault pays in now is said to have cleared.
      const blockers = Array.isArray(inputs.blockers) ? (inputs.blockers as { rule: string; detail: string }[]) : [];
      const found = blockers.filter((b) => b.rule !== "ApprovalRequired");
      const cleared = found.filter((b) => { const t = unsupportedTokenOf(b); return t !== null && Boolean(now.supportedTokens?.has(t)); });
      const still = found.filter((b) => !cleared.includes(b));
      const when = recordedAt(record);
      const titles = (list: typeof found) => list.map((b) => describeRule(b, { seal: "" }).title).join("; ");
      const base = still.length > 0
        ? `Scheduled for the due date. In the way when checked${when ? ` (${when})` : ""}: ${titles(still)}${cleared.length > 0 ? `. Cleared since: ${titles(cleared)}` : ""}`
        : cleared.length > 0
          ? `Scheduled for payment on the due date. Cleared since${when ? ` ${when}` : ""}: ${titles(cleared)}`
          : "Scheduled for payment on the due date";
      return { sentence: `${considered(record)}${base}`, explanation };
    }

    case "reject": {
      return { sentence: rule ? `Rejected: ${rule}` : "Rejected invoice", explanation };
    }

    case "refuse": {
      return { sentence: rule ? `Refused by Vault: ${rule}` : "Refused by Vault simulation", explanation };
    }

    case "skip": {
      // after a payment settles, the next pass finds nothing left to pay; saying "skipped" next to "paid" read as a contradiction (QA UI-2)
      if (outcome === "already_settled") return { sentence: "Nothing left to pay: this invoice is already settled on Arc", explanation };
      return { sentence: rule ? `Skipped: ${rule}` : "Skipped invoice", explanation };
    }

    case "request_approval":
    case "awaiting_approval": {
      return { sentence: rule ? `Awaiting approval: ${rule}` : "Awaiting approval", explanation };
    }

    case "tx": {
      const tx = String(record.txHash ?? inputs.txHash ?? "");
      return { sentence: tx ? `Transaction submitted (${tx.slice(0, 10)}…)` : "Transaction submitted", explanation };
    }

    case "sweep": {
      if (outcome === "depositing" || inputs.venue !== undefined) {
        // QA ACT-1: a suggestion or a prepared move sits next to the "Moved …" row from the chain; say plainly which is which
        if (inputs.actor !== undefined) return { sentence: "Prepared the lending move", explanation };
        if (outcome === "depositing") return { sentence: "Moving excess cash into the lending vault", explanation };
        return { sentence: "The Steward suggested moving cash into the lending vault (a suggestion only; no money moved)", explanation };
      }
      return { sentence: outcome === "subscribing" ? "Sweeping excess cash into USYC reserve" : "Proposed sweep into USYC reserve", explanation };
    }

    case "redeem": {
      if (inputs.venue !== undefined) {
        if (inputs.actor !== undefined) return { sentence: "Prepared the lending withdrawal", explanation };
        if (outcome === "redeeming") return { sentence: "Taking cash out of the lending vault ahead of upcoming bills", explanation };
        return { sentence: "The Steward suggested taking cash out of the lending vault (a suggestion only; no money moved)", explanation };
      }
      return { sentence: outcome === "redeeming" ? "Redeeming USYC reserve ahead of upcoming bills" : "Proposed USYC redemption", explanation };
    }

    // App decisions
    case "steward_mode_changed": {
      // the Steward page names the modes Shadow / Assisted / Autonomous; stored values are shadow / assist / auto (QA VIS-5)
      const modeName = (m: string) => (m === "shadow" ? "Shadow" : m === "assist" ? "Assisted" : m === "auto" ? "Autonomous" : m);
      const from = modeName(String(inputs.from ?? "shadow"));
      const to = modeName(String(inputs.to ?? outcome));
      return { sentence: `Steward mode switched from ${from} to ${to}`, explanation };
    }

    case "steward_fees_funded": {
      const amt = inputs.amount ? `${inputs.amount} units` : "";
      return { sentence: `Steward wallet funded with network fees ${amt}`.trim(), explanation };
    }

    case "deposit_confirmed": {
      const symbol = String(inputs.token ?? "");
      const raw = typeof inputs.amount === "string" && /^\d+$/.test(inputs.amount) ? BigInt(inputs.amount) : null;
      const amount = raw !== null && symbol ? showMoney(formatAmount(raw, 6), symbol) : "";
      // a redeem from lending sends the cash back to the Vault with a token transfer, which the deposit reader also sees (QA retest 18)
      if (isLendingReturn(record, now.lendingVenues)) {
        return { sentence: amount ? `Took ${amount} back from the lending vault` : "Took cash back from the lending vault", explanation };
      }
      return { sentence: amount ? `Added ${amount} to the Vault` : "Added funds to the Vault", explanation };
    }

    case "payee_added": {
      return { sentence: "Payee added to Vault", explanation };
    }

    case "po_opened": {
      const poNum = String(inputs.poNumber ?? "");
      return { sentence: poNum ? `Purchase order opened (${poNum})` : "Purchase order opened", explanation };
    }

    case "po_closed": {
      const poNum = String(inputs.poNumber ?? "");
      return { sentence: poNum ? `Purchase order closed (${poNum})` : "Purchase order closed", explanation };
    }

    case "delivery_confirmed": {
      return { sentence: "Delivery confirmed for invoice", explanation };
    }

    case "delivery_rejected": {
      const reason = String(inputs.reason ?? "");
      return { sentence: reason ? `Delivery rejected: ${reason}` : "Delivery rejected", explanation };
    }

    case "approval_granted": {
      return { sentence: "Payment approval granted by authorized signer", explanation };
    }

    case "approval_rejected": {
      const reason = String(inputs.reason ?? "");
      return { sentence: reason ? `Payment approval rejected: ${reason}` : "Payment approval rejected", explanation };
    }

    case "hold_released": {
      return { sentence: "Hold released by owner; invoice reopened for evaluation", explanation };
    }

    default: {
      return { sentence: RECORDED_ACTIONS[kind] ?? humanizeKind(kind), explanation };
    }
  }
}
