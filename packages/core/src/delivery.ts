import { and, eq } from "drizzle-orm";
import { keccak256, stringToBytes, type Address, type Hex } from "viem";

import { vaultCall } from "@symbolon/chain";
import { deliveries, invoices, notifications, seals, type Database } from "@symbolon/db";

/**
 * Records a delivery confirmation's evidence (a merged pull request, a signed timesheet, a tracker status) and returns
 * the requester's `confirmDelivery(fp)` call. The Vault only pays three-way-matched invoices once it's confirmed onchain.
 */
export async function confirmDelivery(
  db: Database,
  a: { businessId: string; vault: Address; fingerprint: Hex; confirmedBy?: string; source?: string; evidence?: Record<string, unknown> },
) {
  await db
    .insert(deliveries)
    .values({
      businessId: a.businessId,
      fingerprint: a.fingerprint.toLowerCase(),
      confirmedBy: a.confirmedBy ?? null,
      source: a.source ?? "manual",
      evidence: a.evidence ?? {},
    })
    .onConflictDoNothing();
  return vaultCall(a.vault, "confirmDelivery", [a.fingerprint]);
}

/**
 * Flow 12: a requester rejects a delivery. The reason is kept offchain and its hash goes onchain; the invoice is held
 * and the vendor is told why. The vendor can answer with a sealed credit note or a corrected invoice.
 */
export async function rejectDelivery(
  db: Database,
  a: { businessId: string; vault: Address; fingerprint: Hex; reason: string; rejectedBy?: string },
) {
  const reason = a.reason.trim();
  if (!reason) throw new Error("say why the delivery is rejected");
  const reasonHash = keccak256(stringToBytes(reason));
  const fp = a.fingerprint.toLowerCase();
  await db.update(invoices).set({ status: "held" }).where(and(eq(invoices.fingerprint, fp), eq(invoices.businessId, a.businessId)));
  const [inv] = await db.select({ seal: invoices.seal }).from(invoices).where(eq(invoices.fingerprint, fp));
  const [vendor] = inv ? await db.select({ userId: seals.userId }).from(seals).where(eq(seals.address, inv.seal)) : [];
  if (vendor) {
    await db.insert(notifications).values({ userId: vendor.userId, kind: "delivery_rejected", subject: fp, body: { reason, reasonHash } });
  }
  return vaultCall(a.vault, "rejectDelivery", [a.fingerprint, reasonHash]);
}
