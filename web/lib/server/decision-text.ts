import "server-only";

import { usd } from "./policy-text";

export interface DecisionSummary {
  sentence: string;
  explanation?: string;
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

    default: {
      return { sentence: `Recorded: ${kind || "decision"}`, explanation };
    }
  }
}
