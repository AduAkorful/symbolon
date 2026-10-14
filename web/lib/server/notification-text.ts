import "server-only";
import { plainRunError } from "../run-error";

export interface NotificationDescriberInput {
  kind: string;
  subject: string | null;
  body: Record<string, unknown>;
  createdAt: Date;
}

export interface NotificationViewItem {
  title: string;
  body: string;
  href?: string;
}

function vendorOf(body: Record<string, unknown>): string {
  return typeof body.vendorName === "string" && body.vendorName ? body.vendorName : "A vendor";
}

function truncate(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Pure describer turning a notification row into title, body, and safe internal href (plan 05u N4).
 * Never outputs HTML. Text from vendor inputs is length-limited and safe.
 */
export function describeNotification(n: NotificationDescriberInput): NotificationViewItem {
  const { kind, subject, body } = n;

  switch (kind) {
    // ─── Business-side notifications ──────────────────────────────────────────
    case "approval_needed": {
      const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber : subject;
      const vendorName = typeof body.vendorName === "string" ? body.vendorName : "Vendor";
      const total = typeof body.total === "string" ? body.total : "";
      return {
        title: `Approval needed: ${invoiceNumber ?? "Invoice"}`,
        body: `${vendorName}${total ? ` · ${total}` : ""} is awaiting approval.`,
        href: subject ? `/business/inbox/${subject}` : "/business/approvals",
      };
    }

    case "steward_run_failed": {
      const reason = typeof body.reason === "string" ? truncate(plainRunError(body.reason)) : "A Steward cycle encountered an issue or fee shortfall.";
      return {
        title: "Steward cycle alert",
        body: reason,
        href: "/business/steward",
      };
    }

    case "lending_unavailable": {
      return {
        title: "Lending vault can’t pay out right now",
        body: "Part of the money in your lending vault can’t be taken out at the moment. It isn’t counted as cash, and the Vault’s own cash is unaffected.",
        href: "/business/treasury",
      };
    }

    case "verification_awaiting_second": {
      const vendorName = typeof body.vendorName === "string" ? body.vendorName : "Vendor";
      return {
        title: "Second confirmation needed",
        body: `Verification for ${vendorName} is waiting for second confirmation.`,
        href: "/business/vendors",
      };
    }

    case "invoice_received": {
      const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber : "An invoice";
      const vendorName = typeof body.vendorName === "string" ? body.vendorName : "A vendor";
      const total = typeof body.total === "string" ? body.total : "";
      return {
        title: `New invoice: ${invoiceNumber}`,
        body: `${vendorName}${total ? ` sent ${total}` : " sent an invoice"}.`,
        href: subject ? `/business/inbox/${subject}` : "/business/inbox",
      };
    }

    case "invoice_held": {
      const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber : "An invoice";
      const reason = typeof body.reason === "string" && body.reason.trim() ? truncate(body.reason) : "It needs a person to look at it.";
      return {
        title: `Held: ${invoiceNumber}`,
        body: reason.charAt(0).toUpperCase() + reason.slice(1),
        href: subject ? `/business/inbox/${subject}` : "/business/inbox",
      };
    }

    case "offer_received": {
      const vendorName = typeof body.vendorName === "string" ? body.vendorName : "A vendor";
      const percent = typeof body.discountPercent === "string" ? body.discountPercent : null;
      return {
        title: "Early Pay offer",
        body: `${vendorName} offered ${percent ? `${percent}% off` : "a discount"} to be paid early.`,
        href: subject ? `/business/inbox/${subject}` : "/business/inbox",
      };
    }

    case "money_moved": {
      const by = typeof body.by === "string" ? body.by : "A team member";
      const what: Record<string, string> = {
        withdrawn: "withdrew funds from the Vault",
        deposit_confirmed: "added funds to the Vault",
        steward_fees_funded: "topped up the Steward's network fees",
        eurc_conversion: "converted USDC to EURC",
        pay: "paid an invoice from their wallet",
      };
      return {
        title: "Money moved",
        body: `${by} ${what[String(body.action)] ?? "moved money"}.`,
        href: "/business/activity",
      };
    }

    case "vendor_payout_change": {
      return {
        title: "Payout address change requested",
        body: `${vendorOf(body)} requested a payout address change. 72-hour cooldown started.`,
        href: "/business/vendors",
      };
    }

    case "vendor_seal_rotation": {
      return {
        title: "Seal rotation requested",
        body: `${vendorOf(body)} requested to rotate their signing Seal key.`,
        href: "/business/vendors",
      };
    }

    case "vendor_cancel": {
      return {
        title: "Invoice cancellation requested",
        body: `${vendorOf(body)} asked to cancel ${typeof body.invoiceNumber === "string" ? `invoice ${body.invoiceNumber}` : "an invoice"}.`,
        href: "/business/inbox",
      };
    }

    case "vendor_credit_note": {
      return {
        title: "Credit note submitted",
        body: `${vendorOf(body)} submitted a credit note${typeof body.invoiceNumber === "string" ? ` for invoice ${body.invoiceNumber}` : ""}.`,
        href: "/business/inbox",
      };
    }

    // ─── Vendor-side notifications ────────────────────────────────────────────
    case "verification_requested": {
      const name = typeof body.businessName === "string" ? body.businessName : "A business";
      return {
        title: "A business asked to verify you",
        body: `${name} requested a verification code for your Seal. They will contact you over a channel they already trust.`,
        href: "/vendor",
      };
    }

    case "verified_by_business": {
      const name = typeof body.businessName === "string" ? body.businessName : "A business";
      return { title: "You're verified", body: `${name} verified you as a vendor.`, href: "/vendor" };
    }

    case "added_as_payee": {
      const name = typeof body.businessName === "string" ? body.businessName : "A business";
      return { title: "You were added as a payee", body: `${name} added you as a payee. Their invoices to you can be paid once the waiting period passes.`, href: "/vendor" };
    }

    case "payee_active": {
      const name = typeof body.businessName === "string" ? body.businessName : "A business";
      return { title: "You can be paid now", body: `${name}'s waiting period is over. Your invoices to them can be paid.`, href: "/vendor" };
    }

    case "invoice_paid": {
      const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber : subject;
      return {
        title: `Invoice paid: ${invoiceNumber ?? "Settled"}`,
        body: body.partial === true ? "A partial payment was settled onchain." : "Your invoice was settled and paid onchain.",
        href: subject ? `/vendor/invoices/${subject}` : "/vendor",
      };
    }

    case "invoice_cancelled": {
      const invoiceNumber = typeof body.invoiceNumber === "string" && body.invoiceNumber ? body.invoiceNumber : null;
      return {
        title: invoiceNumber ? `Invoice cancelled: ${invoiceNumber}` : "Invoice cancelled",
        body: `${invoiceNumber ? `Invoice ${invoiceNumber}` : "An invoice"} was cancelled on the ledger and can no longer be paid.`,
        href: subject ? `/vendor/invoices/${subject}` : "/vendor",
      };
    }

    case "delivery_rejected": {
      const reason = typeof body.reason === "string" && body.reason.trim()
        ? truncate(body.reason)
        : "Delivery evidence was rejected by the business.";
      return {
        title: "Delivery rejected",
        body: reason,
        href: subject ? `/vendor/invoices/${subject}` : "/vendor",
      };
    }

    case "offer_countered": {
      return {
        title: "Early Pay counter-offer",
        body: "The business made a counter-offer on your Early Pay discount request.",
        href: subject ? `/vendor/invoices/${subject}/early` : "/vendor",
      };
    }

    case "offer_declined": {
      return {
        title: "Early Pay offer declined",
        body: "Your Early Pay discount offer was declined.",
        href: subject ? `/vendor/invoices/${subject}/early` : "/vendor",
      };
    }

    case "payout_change_confirmed": {
      return {
        title: "Payout change confirmed",
        body: "Your payout address change has been confirmed by the business.",
        href: "/vendor",
      };
    }

    case "payout_change_rejected": {
      return {
        title: "Payout change rejected",
        body: "Your payout address change was rejected by the business.",
        href: "/vendor",
      };
    }
    case "payout_change_cancelled": return { title: "Pending payout change cancelled", body: "The business cancelled the pending address change.", href: "/vendor" };

    default: {
      return {
        title: `Notice: ${kind.replace(/_/g, " ")}`,
        body: "A new notification was recorded.",
      };
    }
  }
}
