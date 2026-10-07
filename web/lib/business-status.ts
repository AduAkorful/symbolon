/** What a business is told about an invoice, in words a person would use. Raw states (`awaiting_approval`, `verified`) never reach a screen. */
export type StatusTone = "ink" | "seal" | "red" | "graphite";

export interface BusinessStatus {
  label: string;
  tone: StatusTone;
  /** The reason or next step, when there is one */
  note?: string;
}

/** `holdKind` and `holdSource` come from the invoice row: a delivery hold waits for a confirmation, a payment hold for the owner */
export function businessStatus(status: string, hold?: { source?: string | null; kind?: string | null }): BusinessStatus {
  switch (status) {
    case "paid":
      return { label: "Paid", tone: "seal" };
    case "partially_paid":
      return { label: "Partly paid", tone: "seal" };
    case "scheduled":
      return { label: "Scheduled", tone: "ink" };
    case "awaiting_approval":
      return { label: "Needs approval", tone: "ink", note: "Waiting for someone with approval rights" };
    case "held":
      if (hold?.kind === "delivery") return { label: "Held", tone: "red", note: "Delivery was rejected, or isn't confirmed yet" };
      if (hold?.source === "human") return { label: "Held", tone: "red", note: "Held by a person on your team" };
      return { label: "Held", tone: "red", note: "The Steward is holding it until the rules are met" };
    case "verified":
      return { label: "Checked", tone: "ink", note: "Genuine; waiting for the Steward to decide" };
    case "received":
      return { label: "Received", tone: "graphite", note: "Not checked yet" };
    case "rejected":
      return { label: "Not payable", tone: "red", note: "It failed verification" };
    case "cancelled":
      return { label: "Cancelled", tone: "graphite" };
    default:
      return { label: "Status unavailable", tone: "graphite" };
  }
}

export function trustName(trust: string): { label: string; tone: StatusTone } {
  switch (trust) {
    case "verified":
      return { label: "Verified vendor", tone: "seal" };
    case "new_vendor":
      return { label: "Sealed, new vendor", tone: "ink" };
    case "blocked":
      return { label: "Blocked vendor", tone: "red" };
    case "failed":
      return { label: "Can't be verified", tone: "red" };
    default:
      return { label: "Vendor unknown", tone: "graphite" };
  }
}

export const statusToneClass: Record<StatusTone, string> = { ink: "text-ink", seal: "text-seal", red: "text-red", graphite: "text-graphite" };

/** An unsigned bill: what we found, and where it stands */
export function unsignedLabel(verdict: string | undefined, status: string): BusinessStatus {
  if (status === "fraud") return { label: "Marked as fraud", tone: "red" };
  if (status === "dismissed") return { label: "Dismissed", tone: "graphite" };
  if (status === "invited") return { label: "Vendor invited", tone: "ink", note: "Waiting for them to seal an invoice" };
  return verdict === "likely_impersonation"
    ? { label: "Unsigned, possible impersonation", tone: "red", note: "It can't be paid" }
    : { label: "Unsigned", tone: "ink", note: "It can't be paid until the vendor seals an invoice" };
}
