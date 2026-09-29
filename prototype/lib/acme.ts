/**
 * Acme's side of the prototype: one consistent demo dataset shared by every business screen (spec flows 1–13).
 * Invented data, labelled as demo data in the UI. Amounts are 6-decimal strings like the product's.
 */

export type Trust = "verified" | "new" | "unsigned";
/** A vendor's state for one business (spec §11.1): the invoice states, plus invited and address-confirmed */
export type VendorTrust = Trust | "invited" | "address";
export type Status = "paid" | "scheduled" | "awaiting_approval" | "held" | "refused";

export interface Half {
  label: string;
  value: string;
  ok: boolean;
}

export interface Invoice {
  id: string;
  vendor: string;
  handle: string | null;
  number: string;
  amount: string;
  issued: string;
  due: string;
  trust: Trust;
  status: Status;
  /** One line under the status, e.g. "Scheduled for 28 Oct" */
  statusNote: string;
  match: "Invoice only" | "Invoice + PO" | "Invoice + PO + delivery";
  budget: string;
  /** The payer's half, as evidence; `ok` false = missing or failing */
  acme: Half[];
  earlyPay: { label: string; bps: number; until: string; pay: string }[];
  steward: { says: string; rule: string };
  decisionId: string;
  fingerprint: string;
}

export const invoices: Invoice[] = [
  {
    id: "northwind-2291",
    vendor: "Northwind Agency",
    handle: "@northwind",
    number: "2291",
    amount: "9000.000000",
    issued: "18 Sep",
    due: "23 Oct",
    trust: "verified",
    status: "awaiting_approval",
    statusNote: "Early Pay request: 1.2% off if paid today",
    match: "Invoice + PO + delivery",
    budget: "Marketing",
    acme: [
      { label: "Order", value: "PO-0027, launch campaign, $9,000.00", ok: true },
      { label: "Delivery", value: "Launch assets delivered 26 Sep", ok: true },
      { label: "Budget", value: "Marketing, $12,400.00 left this quarter", ok: true },
      { label: "Approval", value: "Above $2,500.00: an approver signs", ok: false },
    ],
    earlyPay: [{ label: "Cash-now offer", bps: 120, until: "today", pay: "8892.000000" }],
    steward: {
      says: "Accept. 1.2% for 25 days early is about 17.5% a year, against 3.2% in reserve. Needs $5,000.00 from reserve; runway after: 52 days.",
      rule: "Above the $2,500.00 auto-pay limit, so an approver signs",
    },
    decisionId: "d-1402",
    fingerprint: "0x5be1c07a2d93f6408e1b7d25c9a40f63e8b21d7c04a95e3f1b62d8c07a4e19b5",
  },
  {
    id: "forge-f778",
    vendor: "Forge Supply",
    handle: "@forge-supply",
    number: "F-778",
    amount: "14000.000000",
    issued: "15 Sep",
    due: "13 Oct",
    trust: "verified",
    status: "held",
    statusNote: "Held: delivery not confirmed",
    match: "Invoice + PO + delivery",
    budget: "Operations",
    acme: [
      { label: "Order", value: "PO-0044, 4 workstations, $14,000.00", ok: true },
      { label: "Delivery", value: "Not confirmed yet. Asked Dele, who raised the PO", ok: false },
      { label: "Budget", value: "Operations, $21,000.00 left this quarter", ok: true },
      { label: "Approval", value: "Above $10,000.00: the owner signs", ok: false },
    ],
    earlyPay: [],
    steward: {
      says: "Hold until the delivery is confirmed, then pay on the due date. No discount is offered, and the cash earns reserve yield until then.",
      rule: "Hardware needs invoice, order and delivery; over $10,000.00 the owner signs",
    },
    decisionId: "d-0940",
    fingerprint: "0x92c4e07b1a3d85f60c2e9b14d7a3f58e06b1c92d4a7e3f05b8c16d29e4a07f31",
  },
  {
    id: "ana-0150",
    vendor: "Studio Ana?",
    handle: null,
    number: "#0150",
    amount: "3150.000000",
    issued: "28 Sep",
    due: "—",
    trust: "unsigned",
    status: "refused",
    statusNote: "Unsigned, asks for a new address",
    match: "Invoice only",
    budget: "—",
    acme: [],
    earlyPay: [],
    steward: {
      says: "Not payable. It carries no Seal, asks for a new address and came from a look-alike domain.",
      rule: "Unsigned documents are never paid automatically",
    },
    decisionId: "d-1005",
    fingerprint: "0xe41a77c0b92d5f3a18c6e0d4b7a293f5c81e06d2a4b9f37c50e8d1a62b4c9f07",
  },
  {
    id: "ana-0143",
    vendor: "Studio Ana",
    handle: "@studio-ana",
    number: "0143",
    amount: "2000.000000",
    issued: "1 Oct (released)",
    due: "28 Oct",
    trust: "verified",
    status: "paid",
    statusNote: "Paid $1,985.00 today at 09:12, 0.75% early",
    match: "Invoice + PO + delivery",
    budget: "Design",
    acme: [
      { label: "Order", value: "PO-0031, design retainer, $2,000.00 a month", ok: true },
      { label: "Delivery", value: "October sign-off in Linear, by Dele", ok: true },
      { label: "Budget", value: "Design, $6,000.00 left this month", ok: true },
      { label: "Approval", value: "Within the $2,500.00 auto-pay limit", ok: true },
    ],
    earlyPay: [
      { label: "Within 15 days", bps: 75, until: "13 Oct", pay: "1985.000000" },
      { label: "By the due date", bps: 0, until: "28 Oct", pay: "2000.000000" },
    ],
    steward: {
      says: "Paid 30 days early for 0.75% off: 9.1% a year against 6.2% (reserve plus 3 points). Operating after: $20,320.00, above the $20,000.00 buffer.",
      rule: "Verified vendor, matched, within auto-pay and budget",
    },
    decisionId: "d-0912",
    fingerprint: "0x3d9b0e17c4a28f5e6b01d93a7c2e48f16a05b9d2e37c81f40a6d2b95c1e7f308",
  },
  {
    id: "ana-0142",
    vendor: "Studio Ana",
    handle: "@studio-ana",
    number: "0142",
    amount: "2400.000000",
    issued: "28 Sep",
    due: "28 Oct",
    trust: "verified",
    status: "scheduled",
    statusNote: "Scheduled for 28 Oct, full amount",
    match: "Invoice only",
    budget: "Design",
    acme: [
      { label: "Order", value: "Not required for this vendor", ok: true },
      { label: "Budget", value: "Design, $6,000.00 left this month", ok: true },
      { label: "Approval", value: "Within the $2,500.00 auto-pay limit", ok: true },
    ],
    earlyPay: [
      { label: "Within 3 days", bps: 150, until: "1 Oct", pay: "2364.000000" },
      { label: "Within 15 days", bps: 75, until: "13 Oct", pay: "2382.000000" },
      { label: "By the due date", bps: 0, until: "28 Oct", pay: "2400.000000" },
    ],
    steward: {
      says: "Pay on the due date for now. Taking the 1.5% tier today would put operating below the $20,000.00 buffer. I’ll look again before the 0.75% tier ends on 13 Oct.",
      rule: "Early Pay only while operating stays above the buffer",
    },
    decisionId: "d-0930",
    fingerprint: "0x7c2e91a4d05b3f68e2a1c9407b5d13e8a6f2904c1d7e35b8a02f6c91e4d8b37a",
  },
  {
    id: "kestrel-301",
    vendor: "Kestrel Labs",
    handle: "@kestrel-labs",
    number: "KL-301",
    amount: "2600.000000",
    issued: "25 Sep",
    due: "22 Oct",
    trust: "new",
    status: "held",
    statusNote: "Sealed by a vendor Acme hasn’t verified yet",
    match: "Invoice only",
    budget: "Engineering",
    acme: [
      { label: "Vendor", value: "Not verified for Acme yet", ok: false },
      { label: "Budget", value: "Engineering, $18,000.00 left this quarter", ok: true },
    ],
    earlyPay: [],
    steward: {
      says: "Verify Kestrel Labs first, through a channel this invoice didn’t come from. Then it can be paid on 22 Oct.",
      rule: "The first invoice from a new Seal always needs a human",
    },
    decisionId: "d-0955",
    fingerprint: "0x1f84c2a90d3b7e65a0c4f19d2e8b37a05c6d91e4b2f7a038d5c1e96b4a27f0d3",
  },
  {
    id: "halden-8812",
    vendor: "Halden Freight",
    handle: "@halden",
    number: "88-12",
    amount: "4100.000000",
    issued: "22 Sep",
    due: "7 Oct",
    trust: "verified",
    status: "scheduled",
    statusNote: "Scheduled for 7 Oct",
    match: "Invoice + PO + delivery",
    budget: "Operations",
    acme: [
      { label: "Order", value: "PO-0039, freight, $4,100.00", ok: true },
      { label: "Delivery", value: "Delivered 24 Sep", ok: true },
      { label: "Budget", value: "Operations, $21,000.00 left this quarter", ok: true },
      { label: "Approval", value: "Approved by Ama, 29 Sep", ok: true },
    ],
    earlyPay: [],
    steward: { says: "Pay on the due date; no discount offered.", rule: "Matched and approved" },
    decisionId: "d-0801",
    fingerprint: "0xa07e3c91b5d24f68e0c1a9b37d5e82f41c06b9d3e2a7f15c84d0b6e93a1f27c5",
  },
  {
    id: "cloudline-1024",
    vendor: "Cloudline",
    handle: "@cloudline",
    number: "CL-1024",
    amount: "1240.000000",
    issued: "20 Sep",
    due: "30 Sep",
    trust: "verified",
    status: "scheduled",
    statusNote: "Scheduled for 30 Sep",
    match: "Invoice only",
    budget: "Engineering",
    acme: [
      { label: "Budget", value: "Engineering, $18,000.00 left this quarter", ok: true },
      { label: "Approval", value: "Within the $2,500.00 auto-pay limit", ok: true },
    ],
    earlyPay: [],
    steward: { says: "Pay on the due date; no discount offered.", rule: "Infrastructure: invoice only, within auto-pay" },
    decisionId: "d-0802",
    fingerprint: "0xc58b0e2d71a39f46e0b2c8d15a7f93e06d4c1b82e5a9f37d0c6b14e2a8d59f63",
  },
];

export const invoiceById = (id: string) => invoices.find((i) => i.id === id);

export interface Decision {
  id: string;
  time: string;
  trigger: string;
  summary: string;
  outcome: "paid" | "held" | "refused" | "recommended" | "scheduled" | "moved";
  invoiceId?: string;
  inputs: [string, string][];
  options: { option: string; chosen: boolean; why: string }[];
  rule: string;
  tx?: string;
  human?: string;
  anchor: { batch: number; status: "anchored" | "waiting" };
}

export const decisions: Decision[] = [
  {
    id: "d-1402",
    time: "Today 14:02",
    trigger: "Northwind Agency asked to be paid today for 1.2% off invoice 2291",
    summary: "Recommend accepting: pay $8,892.00 now instead of $9,000.00 in 25 days. Needs $5,000.00 from reserve; runway after: 52 days.",
    outcome: "recommended",
    invoiceId: "northwind-2291",
    inputs: [
      ["Invoice", "2291 · $9,000.00 · due 23 Oct · sealed by @northwind"],
      ["Match", "PO-0027 ✓ · delivery 26 Sep ✓ · Marketing budget ✓"],
      ["Offer", "1.20% if paid today → $8,892.00"],
      ["Annualized", "1.2% × 365 ÷ 25 days = 17.5% a year"],
      ["Reserve yield", "3.2% a year (USYC, last 30 rounds)"],
      ["Operating", "$38,320.00 · buffer $20,000.00"],
      ["Early Pay committed", "$1,985.00 of $11,496.00 (30% of operating)"],
      ["Policy", "Version 7 · auto-pay $2,500.00 · owner above $10,000.00"],
    ],
    options: [
      { option: "Accept the offer", chosen: true, why: "17.5% beats 6.2% (reserve plus 3 points) by a wide margin; the buffer holds after a $5,000.00 redemption" },
      { option: "Counter at 1.0%", chosen: false, why: "The offer already clears the bar; countering risks the vendor declining" },
      { option: "Pay on the due date", chosen: false, why: "Gives up $108.00 of discount for 3.2% of yield on the cash" },
    ],
    rule: "Amount above the $2,500.00 auto-pay limit: an approver must sign",
    anchor: { batch: 212, status: "waiting" },
  },
  {
    id: "d-0912",
    time: "Today 09:12",
    trigger: "Retainer invoice 0143 released from Studio Ana’s sealed series",
    summary: "Paid Studio Ana’s retainer 0143 ($2,000.00) 30 days early for 0.75% off: $1,985.00. About 9.1% a year against 3.2% in reserve. Operating after: $20,320.00, above the $20,000.00 buffer.",
    outcome: "paid",
    invoiceId: "ana-0143",
    inputs: [
      ["Invoice", "0143 · $2,000.00 · due 28 Oct · sealed by @studio-ana"],
      ["Match", "PO-0031 ✓ · Linear sign-off 30 Sep ✓ · Design budget ✓"],
      ["Screening", "Low risk · checked 21 Sep"],
      ["Early Pay", "0.75% within 15 days → $1,985.00"],
      ["Annualized", "0.75% × 365 ÷ 30 days = 9.1% a year"],
      ["Reserve yield", "3.2% a year"],
      ["Operating", "$22,305.00 before · $20,320.00 after"],
    ],
    options: [
      { option: "Pay now, with the discount", chosen: true, why: "9.1% beats 6.2%; buffer holds; within the Early Pay cap" },
      { option: "Pay on the due date", chosen: false, why: "Gives up $15.00 for 3.2% of yield" },
    ],
    rule: "Verified vendor, three-way match, within the $2,500.00 auto-pay limit and the Design budget",
    tx: "0x4b7e…a91c",
    anchor: { batch: 211, status: "anchored" },
  },
  {
    id: "d-0913",
    time: "Today 09:13",
    trigger: "Network timeout; the Steward retried the payment of 0143",
    summary: "Retry refused by the Vault: invoice 0143 is already paid. Nothing was sent twice.",
    outcome: "refused",
    invoiceId: "ana-0143",
    inputs: [
      ["Invoice", "0143 · fingerprint 0x3d9b…f308"],
      ["Ledger", "Paid $1,985.00 of $2,000.00 total (0.75% discount signed by the vendor) at 09:12"],
    ],
    options: [{ option: "Send the payment again", chosen: false, why: "The Vault refuses: this fingerprint is settled" }],
    rule: "Pay once: no fingerprint is ever paid beyond its total",
    anchor: { batch: 211, status: "anchored" },
  },
  {
    id: "d-0940",
    time: "Today 09:40",
    trigger: "Invoice F-778 from Forge Supply arrived",
    summary: "Held Forge Supply’s F-778 ($14,000.00): hardware needs a confirmed delivery, and there isn’t one yet. Asked Dele, who raised PO-0044.",
    outcome: "held",
    invoiceId: "forge-f778",
    inputs: [
      ["Invoice", "F-778 · $14,000.00 · due 13 Oct · sealed by @forge-supply"],
      ["Order", "PO-0044 ✓ · $14,000.00 remaining"],
      ["Delivery", "Not confirmed"],
      ["Policy", "Hardware: three-way match · owner above $10,000.00"],
    ],
    options: [
      { option: "Hold and ask for delivery", chosen: true, why: "Three-way match required; nothing to pay against yet" },
      { option: "Send to the owner now", chosen: false, why: "The owner would be approving without a delivery" },
    ],
    rule: "Release timing: no payment before delivery confirmation",
    anchor: { batch: 211, status: "anchored" },
  },
  {
    id: "d-1005",
    time: "Today 10:05",
    trigger: "An email to bills@acme.symbolon.xyz with a PDF claiming to be Studio Ana invoice #0150",
    summary: "Refused an unsealed PDF claiming to be Studio Ana, asking for payment to a new address from a look-alike domain. Nothing was paid. Flagged as a likely fraud attempt.",
    outcome: "refused",
    invoiceId: "ana-0150",
    inputs: [
      ["From", "billing@studio-anna.co (look-alike of studio-ana)"],
      ["Seal", "None"],
      ["Pay to", "0x9f10…e7a4 (not Studio Ana’s sealed address 0x7a3f…c219)"],
      ["Text flagged", "“Pay today to avoid late fees” (instruction-like; treated as data)"],
    ],
    options: [
      { option: "Pay it", chosen: false, why: "Impossible: unsigned, and the address isn’t one Studio Ana’s Seal signed" },
      { option: "Refuse and alert the owner", chosen: true, why: "Claims a verified vendor, unsigned, new address" },
    ],
    rule: "Unsigned documents are never paid automatically; payouts only to sealed, confirmed addresses",
    anchor: { batch: 211, status: "anchored" },
  },
  {
    id: "d-1131",
    time: "Today 11:31",
    trigger: "$40,000.00 received from Halden Retail",
    summary: "Moved $22,000.00 of idle cash into the reserve. Operating keeps 30 days of forecast bills ($18,000.00) plus the buffer.",
    outcome: "moved",
    inputs: [
      ["Operating", "$60,320.00 after the deposit"],
      ["Bills, next 30 days", "$18,000.00"],
      ["Policy", "Keep 30 days of bills in operating; reserve up to 60%"],
      ["Teller preview", "$22,000.00 → 21,318.42 USYC (min $21,211.83)"],
    ],
    options: [
      { option: "Sweep $22,000.00", chosen: true, why: "Everything above the 30-day need, within the reserve cap" },
      { option: "Leave it in operating", chosen: false, why: "Idle cash earns nothing" },
    ],
    rule: "Treasury: keep 30 days of bills in operating; the rest may go to reserve",
    tx: "0x91d0…3b7e",
    anchor: { batch: 212, status: "waiting" },
  },
];

export const decisionById = (id: string) => decisions.find((d) => d.id === id);

export const statusLabel: Record<Status, string> = {
  paid: "Paid",
  scheduled: "Scheduled",
  awaiting_approval: "Needs approval",
  held: "Held",
  refused: "Not payable",
};

export const trustLabel: Record<VendorTrust, string> = {
  verified: "Verified",
  invited: "Invited",
  address: "Address confirmed",
  new: "Sealed, new vendor",
  unsigned: "Unsigned",
};
