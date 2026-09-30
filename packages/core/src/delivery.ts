import { and, eq } from "drizzle-orm";
import { keccak256, stringToBytes, type Address, type Hex } from "viem";

import { vaultCall } from "@symbolon/chain";
import { deliveries, invoices, seals, type Database } from "@symbolon/db";
import { notify } from "./notify.js";

// ─── Pure call-builders (no DB access) ───────────────────────────────────────

/**
 * Returns the `confirmDelivery(fp)` Vault call. No DB writes; call this before sending the tx, show the user what
 * will be signed, then pass the receipt hash to the `recordDelivery` route after confirmation.
 */
export function deliveryConfirmCall(vault: Address, fingerprint: Hex) {
  return vaultCall(vault, "confirmDelivery", [fingerprint]);
}

/**
 * Returns the `rejectDelivery(fp, reasonHash)` Vault call and the hash. Validates and hashes the reason here so the
 * same hash reaches the Vault and the record. Throws if the reason is empty.
 *
 * Call this during `prepareDelivery` to compute and return both the call and the hash to the browser; the browser
 * sends the hash back with the receipt so the record can verify it matches the event.
 */
export function deliveryRejectCall(vault: Address, fingerprint: Hex, reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Delivery rejection needs a reason.");
  const reasonHash = keccak256(stringToBytes(trimmed));
  return { call: vaultCall(vault, "rejectDelivery", [fingerprint, reasonHash]), reasonHash, reason: trimmed };
}

// ─── Record delivery outcome in DB ──────────────────────────────────────────

export interface RecordDeliveryOutcomeArgs {
  businessId: string;
  fingerprint: Hex;
  action: "confirm" | "reject";
  confirmedBy?: string | null;
  txHash?: string | null;
  reason?: string | null;
  reasonHash?: Hex | null;
  source?: string;
  evidence?: Record<string, unknown>;
}

/**
 * Flow 12 / N9 & N10: Records the delivery outcome (confirm or reject) in the database once the onchain receipt
 * has verified. For confirm: marks deliveries as confirmed and releases human holds. For reject: marks deliveries as
 * rejected, holds the invoice with hold_source = 'human', and notifies the vendor.
 */
export async function recordDeliveryOutcome(
  db: Database,
  a: RecordDeliveryOutcomeArgs,
) {
  const fp = a.fingerprint.toLowerCase();
  const txHash = a.txHash?.toLowerCase() ?? null;

  if (a.action === "confirm") {
    await db
      .insert(deliveries)
      .values({
        businessId: a.businessId,
        fingerprint: fp,
        confirmedBy: a.confirmedBy ?? null,
        source: a.source ?? "manual",
        state: "confirmed",
        txHash,
        evidence: a.evidence ?? {},
      })
      .onConflictDoUpdate({
        target: [deliveries.businessId, deliveries.fingerprint],
        set: {
          state: "confirmed",
          reason: null,
          txHash,
          confirmedBy: a.confirmedBy ?? null,
          updatedAt: new Date(),
        },
      });

    // Release a human-held invoice (N9: only human holds, never Steward holds)
    await db
      .update(invoices)
      .set({ status: "verified", holdSource: null })
      .where(
        and(
          eq(invoices.fingerprint, fp),
          eq(invoices.businessId, a.businessId),
          eq(invoices.status, "held"),
          eq(invoices.holdSource!, "human"),
        ),
      );
  } else {
    // a.action === "reject"
    await db
      .insert(deliveries)
      .values({
        businessId: a.businessId,
        fingerprint: fp,
        confirmedBy: a.confirmedBy ?? null,
        source: a.source ?? "manual",
        state: "rejected",
        reason: a.reason ?? null,
        txHash,
        evidence: a.evidence ?? {},
      })
      .onConflictDoUpdate({
        target: [deliveries.businessId, deliveries.fingerprint],
        set: {
          state: "rejected",
          reason: a.reason ?? null,
          txHash,
          confirmedBy: a.confirmedBy ?? null,
          updatedAt: new Date(),
        },
      });

    // Hold the invoice from any payable state
    for (const fromStatus of ["verified", "awaiting_approval", "scheduled"] as const) {
      await db
        .update(invoices)
        .set({ status: "held", holdSource: "human" })
        .where(
          and(
            eq(invoices.fingerprint, fp),
            eq(invoices.businessId, a.businessId),
            eq(invoices.status, fromStatus),
          ),
        );
    }

    // Notify vendor if known
    const [inv] = await db
      .select({ seal: invoices.seal })
      .from(invoices)
      .where(and(eq(invoices.fingerprint, fp), eq(invoices.businessId, a.businessId)))
      .limit(1);
    if (inv) {
      const [vendor] = await db
        .select({ userId: seals.userId })
        .from(seals)
        .where(eq(seals.address, inv.seal))
        .limit(1);
      if (vendor) {
        await notify(db, {
          userId: vendor.userId,
          kind: "delivery_rejected",
          subject: fp,
          body: { reason: a.reason ?? "", reasonHash: a.reasonHash ?? "" },
          dedupeKey: `delivery_rejected:${fp}`,
        });
      }
    }
  }
}

