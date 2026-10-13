import type { VaultPolicy } from "@symbolon/steward";

/** Whole token units the form takes (12 digits, as everywhere amounts are typed), and the longest a delay can be set to */
const MAX_AMOUNT_RAW = 10n ** 12n * 10n ** 6n;
const MAX_DELAY_SECONDS = 365n * 86_400n;
const MAX_MIN_PAID = 10_000;

/**
 * What is wrong with a proposed policy, and what is merely worth a second look (plan 05zj E, SYM-28). Before this the server did
 * `BigInt(x)` on whatever came in, so a minus sign reached the encoder and failed there with a generic message. Errors stop the
 * change; warnings are shown before signing and don't. The Vault's own rules are unchanged: this is the app saying it first.
 */
export function checkPolicyInput(p: Record<keyof VaultPolicy, bigint | number>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const amount = (key: "perTxCap" | "autoPayLimit" | "ownerThreshold" | "maxBridgeFee", label: string) => {
    const v = BigInt(p[key]);
    if (v < 0n) errors.push(`${label} can't be negative.`);
    else if (v > MAX_AMOUNT_RAW) errors.push(`${label} is larger than this app accepts.`);
  };
  amount("perTxCap", "The largest single payment");
  amount("autoPayLimit", "The auto-pay limit");
  amount("ownerThreshold", "The owner's signing amount");
  amount("maxBridgeFee", "The bridge fee limit");
  if (BigInt(p.perTxCap) === 0n) errors.push("The largest single payment can't be zero: nothing could ever be paid.");

  const count = Number(p.newVendorMinPaid);
  if (!Number.isInteger(count) || count < 0) errors.push("Invoices before a vendor is trusted must be a whole number, zero or more.");
  else if (count > MAX_MIN_PAID) errors.push(`Invoices before a vendor is trusted can't be more than ${MAX_MIN_PAID}.`);

  for (const [key, label] of [
    ["screeningMaxAge", "The screening age"],
    ["newPayeeDelay", "The new-payee wait"],
    ["changeCooldown", "The payout-change cooldown"],
    ["looseningDelay", "The loosening delay"],
  ] as const) {
    const v = BigInt(p[key]);
    if (v < 0n) errors.push(`${label} can't be negative.`);
    else if (v > MAX_DELAY_SECONDS) errors.push(`${label} can't be longer than a year.`);
  }

  if (errors.length === 0) {
    if (BigInt(p.autoPayLimit) > BigInt(p.ownerThreshold)) warnings.push("The auto-pay limit is above the amount the owner signs over, so the owner's sign-off would never be the one asked for between them.");
    if (BigInt(p.ownerThreshold) > BigInt(p.perTxCap)) warnings.push("The owner signs above an amount larger than the largest single payment, so that threshold can never be reached.");
  }
  return { errors, warnings };
}
