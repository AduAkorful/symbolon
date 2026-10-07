import "server-only";

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
  credit_note: "Applied a credit note",
  invoice_cancelled: "Cancelled an invoice",
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
  const words = kind.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "A change was recorded";
}

/**
 * Pure function deriving a single plain English sentence from a decision record's own fields (S14).
 * Handles all core Steward kinds (pay, hold, schedule, reject, skip, refuse, request_approval, tx, sweep, redeem)
 * and app-level actions (steward_mode_changed, steward_fees_funded, payee_added, po_opened, po_closed,
 * delivery_confirmed, delivery_rejected).
 */
export function summarizeDecision(record: Record<string, unknown>): DecisionSummary {
  const kind = String(record.kind ?? "");
  const outcome = String(record.outcome ?? "");
  const rule = String(record.rule ?? "");
  const inputs = (record.inputs as Record<string, unknown> | undefined) ?? {};
  const explanation = typeof record.explanation === "string" ? record.explanation : undefined;

  switch (kind) {
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
      return { sentence: "Scheduled for payment on due date", explanation };
    }

    case "reject": {
      return { sentence: rule ? `Rejected: ${rule}` : "Rejected invoice", explanation };
    }

    case "refuse": {
      return { sentence: rule ? `Refused by Vault: ${rule}` : "Refused by Vault simulation", explanation };
    }

    case "skip": {
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
      return { sentence: outcome === "subscribing" ? "Sweeping excess cash into USYC reserve" : "Proposed sweep into USYC reserve", explanation };
    }

    case "redeem": {
      return { sentence: outcome === "redeeming" ? "Redeeming USYC reserve ahead of upcoming bills" : "Proposed USYC redemption", explanation };
    }

    // App decisions
    case "steward_mode_changed": {
      const from = String(inputs.from ?? "shadow");
      const to = String(inputs.to ?? outcome);
      return { sentence: `Steward mode switched from ${from} to ${to}`, explanation };
    }

    case "steward_fees_funded": {
      const amt = inputs.amount ? `${inputs.amount} units` : "";
      return { sentence: `Steward wallet funded with network fees ${amt}`.trim(), explanation };
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
