import "server-only";

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
      const reason = typeof body.reason === "string" ? truncate(body.reason) : "A Steward cycle encountered an issue or fee shortfall.";
      return {
        title: "Steward cycle alert",
        body: reason,
        href: "/business/steward",
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

    case "vendor_payout_change": {
      return {
        title: "Payout address change requested",
        body: "A vendor requested a payout address change. 72-hour cooldown started.",
        href: "/business/vendors",
      };
    }

    case "vendor_seal_rotation": {
      return {
        title: "Seal rotation requested",
        body: "A vendor requested to rotate their signing Seal key.",
        href: "/business/vendors",
      };
    }

    case "vendor_cancel": {
      return {
        title: "Invoice cancellation requested",
        body: "A vendor submitted an invoice cancellation request.",
        href: "/business/inbox",
      };
    }

    case "vendor_credit_note": {
      return {
        title: "Credit note submitted",
        body: "A vendor submitted a credit note.",
        href: "/business/inbox",
      };
    }

    // ─── Vendor-side notifications ────────────────────────────────────────────
    case "invoice_paid": {
      const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber : subject;
      return {
        title: `Invoice paid: ${invoiceNumber ?? "Settled"}`,
        body: "Your invoice was settled and paid onchain.",
        href: subject ? `/vendor/invoices/${subject}` : "/vendor",
      };
    }

    case "invoice_cancelled": {
      return {
        title: "Invoice cancelled",
        body: `Invoice ${subject ?? ""} was marked cancelled on the ledger.`,
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

    default: {
      return {
        title: `Notice: ${kind.replace(/_/g, " ")}`,
        body: "A new notification was recorded.",
      };
    }
  }
}
