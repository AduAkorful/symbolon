/**
 * What stands between an invoice and its payment, in words a person can act on (plan 05zj C, SYM-05/06/10/11).
 *
 * The facts come from the Steward's own mirror of the Vault's rules (`checkPayment`), so this page can't say something the Vault
 * wouldn't. Each blocker names what it is and, where a person can deal with it, where to do that. Pure and shared: the invoice page,
 * the pay-now answer and the Needs-you queue all describe a rule the same way.
 */

export interface BlockerAction {
  label: string;
  href: string;
}

export interface Blocker {
  /** The Vault rule's name, or a business-side reason (`VendorNotVerified`, `VendorBlocked`, `PossibleDuplicate`) */
  rule: string;
  title: string;
  detail: string;
  /** `action`: a person has to do something; `wait`: time alone fixes it; `info`: it will be asked for when it matters */
  kind: "action" | "wait" | "info";
  action?: BlockerAction;
}

export interface BlockerContext {
  /** The vendor's Seal, for the links to their page */
  seal: string;
  /** Vault time and the payee's activation time, for the countdown */
  now?: bigint;
  activeAt?: bigint;
}

/** "about 23 hours", "about 2 days", "a few minutes": a countdown for someone deciding whether to come back later */
export function waitText(seconds: bigint): string {
  if (seconds <= 0n) return "now";
  if (seconds < 3_600n) {
    const minutes = (seconds + 59n) / 60n;
    return minutes <= 1n ? "a minute" : `about ${minutes} minutes`;
  }
  if (seconds < 2n * 86_400n) {
    const hours = (seconds + 3_599n) / 3_600n;
    return hours === 1n ? "about an hour" : `about ${hours} hours`;
  }
  return `about ${(seconds + 86_399n) / 86_400n} days`;
}

const vendorPage = (seal: string) => `/business/vendors/${seal.toLowerCase()}`;

/** One failed Vault rule, as a blocker. Unknown rule names are kept, with the mirror's own words, so nothing is hidden. */
export function describeRule(failure: { rule: string; detail: string }, ctx: BlockerContext): Blocker {
  const { rule, detail } = failure;
  switch (rule) {
    case "VaultPaused":
      return { rule, kind: "action", title: "The Vault is paused", detail: "Nothing can be paid while the owner has payments paused.", action: { label: "Resume payments", href: "/business/steward" } };
    case "UnsupportedToken":
      return { rule, kind: "action", title: "The Vault doesn't accept this currency", detail: "This invoice is in a token the Vault isn't set up to pay.", action: { label: "Open settings", href: "/business/settings" } };
    case "UnknownPayee":
      return { rule, kind: "action", title: "This vendor isn't a payee of the Vault yet", detail: "A vendor has to be verified and added as a payee before the Vault will pay them.", action: { label: "Set up this vendor", href: vendorPage(ctx.seal) } };
    case "PayeeNotActive": {
      const left = ctx.activeAt !== undefined && ctx.now !== undefined ? ctx.activeAt - ctx.now : undefined;
      return {
        rule,
        kind: "wait",
        title: left !== undefined && left > 0n ? `This payee can be paid in ${waitText(left)}` : "This payee isn't active yet",
        detail: "A new payee waits out the Vault's waiting period before it can be paid. Nothing to do but wait.",
      };
    }
    case "PayeeRetired":
      return { rule, kind: "action", title: "This payee was retired", detail: "The Vault no longer pays this vendor.", action: { label: "Open the vendor", href: vendorPage(ctx.seal) } };
    case "PayoutMismatch":
      return { rule, kind: "action", title: "The invoice's payout address isn't the confirmed one", detail: "The Vault pays only the payout address it has confirmed for this vendor.", action: { label: "Open the vendor", href: vendorPage(ctx.seal) } };
    case "PayeeBlocked":
      return { rule, kind: "action", title: "Screening blocked this payee", detail: "The payee's screening result stops the Vault from paying.", action: { label: "Open Compliance", href: "/business/compliance" } };
    case "ScreeningStale":
      return { rule, kind: "action", title: "This payee needs a screening", detail: "This Vault's policy requires a recent screening of the payout address before paying.", action: { label: "Screen it", href: "/business/compliance" } };
    case "PurchaseOrderRequired":
      return { rule, kind: "action", title: "This vendor's invoices need a purchase order", detail: "This invoice doesn't cite one.", action: { label: "Open orders", href: "/business/orders" } };
    case "PurchaseOrderNotOpen":
      return { rule, kind: "action", title: "The purchase order isn't open", detail: "The order this invoice cites isn't open in the Vault.", action: { label: "Open orders", href: "/business/orders" } };
    case "PurchaseOrderWrongVendor":
      return { rule, kind: "action", title: "The purchase order belongs to another vendor", detail: "The order this invoice cites was opened for a different vendor.", action: { label: "Open orders", href: "/business/orders" } };
    case "PurchaseOrderNotReleased":
      return { rule, kind: "wait", title: "The purchase order isn't released yet", detail: "The order has a release date that hasn't arrived." };
    case "PurchaseOrderExceeded":
      return { rule, kind: "action", title: "The invoice is more than the order has left", detail: "The invoice is larger than what remains on the purchase order.", action: { label: "Open orders", href: "/business/orders" } };
    case "DeliveryNotConfirmed":
      return { rule, kind: "action", title: "Delivery hasn't been confirmed", detail: "This vendor's terms need delivery confirmed before payment.", action: { label: "Confirm delivery", href: "#delivery" } };
    case "PerTxCapExceeded":
      return { rule, kind: "action", title: "Over the per-payment limit", detail: "This payment is larger than the most the Vault pays at once.", action: { label: "Open policy", href: "/business/policy" } };
    case "PayeeCapExceeded":
      return { rule, kind: "action", title: "Over this vendor's monthly cap", detail: "Paying this would take the vendor past their monthly cap.", action: { label: "Open the vendor", href: vendorPage(ctx.seal) } };
    case "BudgetExceeded":
      return { rule, kind: "action", title: "Over the budget", detail: "Paying this would take the budget past its cap.", action: { label: "Open policy", href: "/business/policy" } };
    case "UnknownBudget":
      return { rule, kind: "action", title: "The budget doesn't exist", detail: "The budget this payee or order uses can't be found in the Vault.", action: { label: "Open policy", href: "/business/policy" } };
    case "ApprovalRequired":
      // the Steward can't pay this alone (it is over what it may pay without a person); an owner or approver paying it from their
      // own wallet is the sign-off, so Pay now needs no separate step (QA retest 5, R5-1)
      return {
        rule,
        kind: "info",
        title: "The Steward can't pay this on its own",
        // Approvals lists it only once it is due (or ahead of time in Autonomous mode), so no link here: it would open an empty list (QA STW-2)
        detail: `${sentence(detail)} The owner or an approver can pay it now with Pay now. Otherwise it appears in Approvals when it comes due; in Autonomous mode it is listed there ahead of time under "Coming up that need your sign-off".`,
      };
    case "CrossChainPayout":
    case "CrossChainTokenUnsupported":
    case "CrossChainAmountTooLarge":
      return { rule, kind: "action", title: "Payout is on another chain", detail: "Payments are made on Arc only for now. This invoice pays out elsewhere, so it can't be paid from here." };
    case "BridgeFeeTooHigh":
      return { rule, kind: "action", title: "The transfer fee is over the limit", detail: sentence(detail) };
    default:
      return { rule, kind: "action", title: sentence(rule.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()), detail: sentence(detail) };
  }
}

function sentence(text: string): string {
  const t = text.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : t;
}

/** Business-side reasons that aren't Vault rules */
export function vendorBlocker(trust: "verified" | "new_vendor" | "blocked" | "failed", seal: string): Blocker | null {
  if (trust === "verified") return null;
  if (trust === "blocked") {
    return { rule: "VendorBlocked", kind: "action", title: "You've blocked this vendor", detail: "Nothing from this vendor is paid while it is blocked.", action: { label: "Open the vendor", href: vendorPage(seal) } };
  }
  if (trust === "failed") {
    return { rule: "InvoiceFailed", kind: "action", title: "The stored invoice doesn't check out", detail: "The signature or document no longer verifies, so it can't be paid." };
  }
  return { rule: "VendorNotVerified", kind: "action", title: "This vendor isn't verified yet", detail: "Confirm this is the company you mean to pay. Only then can it be added as a payee.", action: { label: "Verify the vendor", href: vendorPage(seal) } };
}
