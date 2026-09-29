/**
 * Studio Ana's side of the prototype (the vendor app). Consistent with Acme's side (lib/acme.ts): 0143 was paid early
 * today, 0142 is scheduled at Acme for 28 Oct. Invented data, labelled as demo data in the UI.
 */

export type VStatus = "draft" | "sent" | "viewed" | "scheduled" | "paid" | "cancelled";

export interface VInvoice {
  id: string;
  number: string;
  client: string;
  clientOn: boolean;
  amount: string;
  issued: string;
  due: string;
  status: VStatus;
  note: string;
  /** Events so far, oldest first */
  timeline: { at: string; what: string; done: boolean }[];
  paid?: { amount: string; at: string; discountBps: number; tx: string };
  fingerprint: string;
}

export const vInvoices: VInvoice[] = [
  {
    id: "0143",
    number: "0143",
    client: "Acme Operations",
    clientOn: true,
    amount: "2000.000000",
    issued: "1 Oct (series)",
    due: "28 Oct",
    status: "paid",
    note: "Paid 30 days early, 0.75% off",
    timeline: [
      { at: "3 Sep", what: "Series sealed: 6 monthly invoices", done: true },
      { at: "Today 09:00", what: "Released to Acme", done: true },
      { at: "09:11", what: "Matched to PO-0031 and October’s sign-off", done: true },
      { at: "09:12", what: "Paid $1,985.00 on Arc", done: true },
    ],
    paid: { amount: "1985.000000", at: "Today 09:12", discountBps: 75, tx: "0x4b7e…a91c" },
    fingerprint: "0x3d9b0e17c4a28f5e6b01d93a7c2e48f16a05b9d2e37c81f40a6d2b95c1e7f308",
  },
  {
    id: "0142",
    number: "0142",
    client: "Acme Operations",
    clientOn: true,
    amount: "2400.000000",
    issued: "28 Sep",
    due: "28 Oct",
    status: "scheduled",
    note: "Acme scheduled it for 28 Oct",
    timeline: [
      { at: "28 Sep", what: "Sealed and sent", done: true },
      { at: "28 Sep", what: "Viewed by Acme", done: true },
      { at: "28 Sep", what: "Verified by Acme’s Steward", done: true },
      { at: "28 Oct", what: "Scheduled payment", done: false },
    ],
    fingerprint: "0x7c2e91a4d05b3f68e2a1c9407b5d13e8a6f2904c1d7e35b8a02f6c91e4d8b37a",
  },
  {
    id: "0140",
    number: "0140",
    client: "Kite & Co",
    clientOn: false,
    amount: "1650.000000",
    issued: "18 Sep",
    due: "2 Oct",
    status: "viewed",
    note: "Viewed 3 times; not on Symbolon yet",
    timeline: [
      { at: "18 Sep", what: "Sealed and sent", done: true },
      { at: "19 Sep", what: "Viewed", done: true },
      { at: "2 Oct", what: "Due", done: false },
    ],
    fingerprint: "0x0e5a3c81f2d94b76a1c0e8d37b5f29a4c6e1d08b3f7a25c94e0d1b86a3c7f52e",
  },
  {
    id: "0139",
    number: "0139",
    client: "Morrow Labs",
    clientOn: false,
    amount: "3200.000000",
    issued: "25 Sep",
    due: "25 Oct",
    status: "sent",
    note: "Sent, not viewed yet",
    timeline: [
      { at: "25 Sep", what: "Sealed and sent", done: true },
      { at: "—", what: "Not viewed yet", done: false },
    ],
    fingerprint: "0xb3d71e09c5a24f86e0b1c9d27a4f53e8c0d6a19b2e7f43c85d0a1e96b4c27f1d",
  },
  {
    id: "0141",
    number: "0141",
    client: "Halden Retail",
    clientOn: true,
    amount: "1800.000000",
    issued: "3 Sep",
    due: "3 Oct",
    status: "paid",
    note: "Paid 12 Sep, full amount",
    timeline: [
      { at: "3 Sep", what: "Sealed and sent", done: true },
      { at: "12 Sep", what: "Paid $1,800.00 on Arc", done: true },
    ],
    paid: { amount: "1800.000000", at: "12 Sep", discountBps: 0, tx: "0x2c19…7d40" },
    fingerprint: "0xd5e20b7c4a91f36e8b0d2c17a4e59f3b06c8d1a2e4b7f90c35d6a1e28b9c47f0",
  },
];

export const vInvoiceById = (id: string) => vInvoices.find((i) => i.id === id);

export const clients = [
  { name: "Acme Operations", on: true, invoices: 8, paid: "$15,985.00", avgDays: "1 day", note: "Pays through its Steward; takes Early Pay when it clears their bar" },
  { name: "Halden Retail", on: true, invoices: 3, paid: "$5,400.00", avgDays: "9 days", note: "Pays on arrival" },
  { name: "Kite & Co", on: false, invoices: 2, paid: "$1,650.00", avgDays: "24 days", note: "Invited; pays from a wallet so far" },
  { name: "Morrow Labs", on: false, invoices: 1, paid: "—", avgDays: "—", note: "Invited with invoice 0139" },
];

export const vStatusLabel: Record<VStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  scheduled: "Scheduled",
  paid: "Paid",
  cancelled: "Cancelled",
};
