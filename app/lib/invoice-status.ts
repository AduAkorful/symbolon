/** What a vendor is told about an invoice's state. Only states that are true for them: internal holds and approvals stay the payer's business. */
export function vendorStatus(status: string): { label: string; tone: "ink" | "seal" | "red" | "graphite" } {
  switch (status) {
    case "paid":
      return { label: "Paid", tone: "seal" };
    case "partially_paid":
      return { label: "Partly paid", tone: "seal" };
    case "cancelled":
      return { label: "Cancelled", tone: "graphite" };
    case "rejected":
      return { label: "Rejected", tone: "red" };
    default:
      return { label: "Sealed", tone: "ink" };
  }
}

export const toneClass = { ink: "text-ink", seal: "text-seal", red: "text-red", graphite: "text-graphite" } as const;
