import { and, eq, lt } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";

import { earlyPayOffers, invoices, type Database } from "@symbolon/db";
import { digest, MAX_DISCOUNT_BPS, sealDomain, verifySealSignature, type SignatureClient } from "@symbolon/seal";

/**
 * Stores a vendor's cash-now offer (spec §6.3, §10) after checking it's signed by the invoice's own Seal over the exact
 * terms; the ledger checks the same signature again when the discount is claimed.
 */
export async function recordOffer(
  db: Database,
  deployment: { chainId: number; ledger: Address },
  o: { fingerprint: Hex; discountBps: number; validUntil: bigint; signature: Hex },
  opts: { client?: SignatureClient; now?: Date } = {},
): Promise<{ id: string }> {
  if (!Number.isInteger(o.discountBps) || o.discountBps < 1 || o.discountBps > MAX_DISCOUNT_BPS) throw new Error("discount out of range");
  const now = opts.now ?? new Date();
  if (Number(o.validUntil) * 1000 <= now.getTime()) throw new Error("offer already expired");
  const [inv] = await db.select().from(invoices).where(eq(invoices.fingerprint, o.fingerprint.toLowerCase()));
  if (!inv) throw new Error("unknown invoice");
  const d = digest(sealDomain(deployment.chainId, deployment.ledger), "EarlyPayOffer", {
    fingerprint: o.fingerprint,
    discountBps: o.discountBps,
    validUntil: o.validUntil,
  });
  const check = await verifySealSignature({ signer: getAddress(inv.seal), digest: d, signature: o.signature, client: opts.client });
  if (!check.valid) throw new Error(`offer isn't signed by the invoice's Seal: ${check.reason}`);
  const [row] = await db
    .insert(earlyPayOffers)
    .values({ fingerprint: o.fingerprint.toLowerCase(), discountBps: o.discountBps, validUntil: new Date(Number(o.validUntil) * 1000), signature: o.signature.toLowerCase() })
    .returning({ id: earlyPayOffers.id });
  return { id: row!.id };
}

/**
 * The payer's counter (spec §10.2: the Steward may counter once). A counter is unsigned and can't be used to pay;
 * the vendor accepts by signing an offer with those terms, which `recordOffer` then stores.
 */
export async function counterOffer(db: Database, o: { fingerprint: Hex; discountBps: number; validUntil: Date }): Promise<{ id: string }> {
  const existing = await db
    .select()
    .from(earlyPayOffers)
    .where(and(eq(earlyPayOffers.fingerprint, o.fingerprint.toLowerCase()), eq(earlyPayOffers.status, "countered")));
  if (existing.length > 0) throw new Error("already countered once");
  const [row] = await db
    .insert(earlyPayOffers)
    .values({ fingerprint: o.fingerprint.toLowerCase(), discountBps: o.discountBps, validUntil: o.validUntil, status: "countered" })
    .returning({ id: earlyPayOffers.id });
  return { id: row!.id };
}

export async function expireOffers(db: Database, now: Date): Promise<number> {
  const rows = await db
    .update(earlyPayOffers)
    .set({ status: "expired" })
    .where(and(eq(earlyPayOffers.status, "open"), lt(earlyPayOffers.validUntil, now)))
    .returning({ id: earlyPayOffers.id });
  return rows.length;
}
