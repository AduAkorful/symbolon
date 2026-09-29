/**
 * Demo data for the prototype, drawn from the spec's own flows (Studio Ana, Acme, Northwind, Forge Supply).
 * Everything here is invented and every screen labels it as demo data. Addresses and fingerprints are placeholders.
 */

export const vendor = {
  name: "Studio Ana",
  handle: "@studio-ana",
  payout: "0x7a3f…c219",
  chain: "Arc",
  token: "USDC",
};

export const payer = {
  name: "Acme Operations",
  email: "finance@acme.example",
};

export const invoice = {
  number: "0142",
  fingerprint: "0x7c2e91a4d05b3f68e2a1c9407b5d13e8a6f2904c1d7e35b8a02f6c91e4d8b37a",
  issued: "28 Sep 2026",
  due: "28 Oct 2026",
  lines: [
    { description: "Brand identity — discovery and moodboards", qty: "1", amount: "800.000000" },
    { description: "Logo system and usage guidelines", qty: "1", amount: "1200.000000" },
    { description: "Launch assets, 12 templates", qty: "1", amount: "400.000000" },
  ],
  total: "2400.000000",
  earlyPay: [
    { label: "Within 3 days", bps: 150, pay: "2364.000000", until: "1 Oct" },
    { label: "Within 15 days", bps: 75, pay: "2382.000000", until: "13 Oct" },
    { label: "By the due date", bps: 0, pay: "2400.000000", until: "28 Oct" },
  ],
  attachment: "project-brief.pdf",
};

export const retainer = {
  number: "0143",
  fingerprint: "0x3d9b0e17c4a28f5e6b01d93a7c2e48f16a05b9d2e37c81f40a6d2b95c1e7f308",
  amount: "2000.000000",
  paid: "1985.000000",
  po: "PO-0031",
  poCap: "2000.000000",
};

export const fraud = {
  from: "billing@studio-anna.co",
  subject: "New wallet — please pay invoice #0150 to our updated address",
  claimedAmount: "3,150.00",
  newAddress: "0x9f10…e7a4",
  fingerprint: "0xe41a77c0b92d5f3a18c6e0d4b7a293f5c81e06d2a4b9f37c50e8d1a62b4c9f07",
};

export const vault = {
  operating: "38320.000000",
  eurc: "2100.000000",
  reserve: "22000.000000",
  runwayDays: 41,
};

/** Split a 6-decimal amount into its displayed and its precision part: "2400.000000" → ["2,400", ".00", "0000"] */
export function money(raw: string): [whole: string, cents: string, rest: string] {
  const [int = "0", frac = ""] = raw.split(".");
  const whole = Number(int).toLocaleString("en-US");
  const f = frac.padEnd(6, "0");
  return [whole, `.${f.slice(0, 2)}`, f.slice(2)];
}
