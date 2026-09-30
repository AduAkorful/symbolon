import { and, eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";

import { ledgerCall, vaultCall } from "@symbolon/chain";
import { members, vendorRequests, type Database } from "@symbolon/db";
import { notifyMany } from "./notify.js";
import {
  decodeSealedInvoice,
  deriveInvoice,
  digest,
  fingerprint as fingerprintOf,
  sealDomain,
  verifySealSignature,
  type CreditNote,
  type PayoutChange,
  type SealRotation,
  type SignatureClient,
} from "@symbolon/seal";

import { toRecordValue } from "@symbolon/steward";

export type VendorRequest =
  | { kind: "payout_change"; message: PayoutChange }
  | { kind: "seal_rotation"; message: SealRotation }
  | { kind: "cancel"; envelope: string }
  | { kind: "credit_note"; envelope: string; message: CreditNote };

interface Deployment {
  chainId: number;
  ledger: Address;
}

/** Who must have signed a request, and the digest they signed */
function signedBy(d: Deployment, r: VendorRequest): { signer: Address; digest: Hex; fingerprint?: Hex } {
  const domain = sealDomain(d.chainId, d.ledger);
  switch (r.kind) {
    case "payout_change":
      return { signer: r.message.seal, digest: digest(domain, "PayoutChange", r.message) };
    case "seal_rotation":
      // the handover is signed by the key being retired
      return { signer: r.message.oldSeal, digest: digest(domain, "SealRotation", r.message) };
    case "cancel": {
      const inv = deriveInvoice(decodeSealedInvoice(r.envelope).document);
      const fp = fingerprintOf(domain, inv);
      return { signer: inv.seal, digest: digest(domain, "Cancel", { fingerprint: fp }), fingerprint: fp };
    }
    case "credit_note": {
      const inv = deriveInvoice(decodeSealedInvoice(r.envelope).document);
      const fp = fingerprintOf(domain, inv);
      if (r.message.fingerprint.toLowerCase() !== fp.toLowerCase()) throw new Error("credit note names another invoice");
      return { signer: inv.seal, digest: digest(domain, "CreditNote", r.message), fingerprint: fp };
    }
  }
}

/**
 * Stores a vendor-signed request after checking the signature exactly as the contracts will, and tells the business's
 * owners. Nothing changes onchain until an owner confirms (payout/Seal changes) or someone submits the signed
 * cancel/credit note to the ledger; the Vault's cooldown then applies to payout and Seal changes.
 */
export async function submitVendorRequest(
  db: Database,
  d: Deployment,
  businessId: string | undefined,
  request: VendorRequest,
  signature: Hex,
  opts: { client?: SignatureClient } = {},
): Promise<{ id: string }> {
  const { signer, digest: dg, fingerprint } = signedBy(d, request);
  const check = await verifySealSignature({ signer, digest: dg, signature, client: opts.client });
  if (!check.valid) throw new Error(`request signature rejected: ${check.reason}`);

  const message =
    request.kind === "cancel" ? { envelope: request.envelope } : toRecordValue({ ...request.message, ...(request.kind === "credit_note" ? { envelope: request.envelope } : {}) });
  const [row] = await db
    .insert(vendorRequests)
    .values({
      businessId: businessId ?? null,
      seal: signer.toLowerCase(),
      kind: request.kind,
      message: message as Record<string, unknown>,
      signature: signature.toLowerCase(),
      ...(fingerprint ? { fingerprint: fingerprint.toLowerCase() } : {}),
    })
    .returning({ id: vendorRequests.id });

  if (businessId) {
    const owners = await db.select({ userId: members.userId }).from(members).where(and(eq(members.businessId, businessId), eq(members.role, "owner")));
    if (owners.length) {
      await notifyMany(
        db,
        owners.map((o) => ({
          userId: o.userId,
          kind: `vendor_${request.kind}`,
          subject: row!.id,
          body: { seal: signer.toLowerCase(), kind: request.kind, loud: request.kind === "payout_change" || request.kind === "seal_rotation" },
          dedupeKey: `vendor_req:${row!.id}:${o.userId}`,
        })),
      );
    }
  }
  return { id: row!.id };
}

/**
 * The transaction that acts on a stored request. Payout changes and Seal rotations are confirmed by the Vault's owner
 * (the Vault then starts its cooldown); cancels and credit notes can be submitted to the ledger by anyone.
 */
export async function requestCall(db: Database, d: Deployment, requestId: string, vault?: Address) {
  const [r] = await db.select().from(vendorRequests).where(eq(vendorRequests.id, requestId));
  if (!r) throw new Error(`no request ${requestId}`);
  const m = r.message as Record<string, string>;
  const sig = r.signature as Hex;
  switch (r.kind) {
    case "payout_change":
      if (!vault) throw new Error("the owner confirms a payout change on their Vault");
      return vaultCall(vault, "confirmPayoutChange", [
        { seal: getAddress(m.seal!), newPayout: getAddress(m.newPayout!), payoutDomain: Number(m.payoutDomain), nonce: BigInt(m.nonce!) },
        sig,
      ]);
    case "seal_rotation":
      if (!vault) throw new Error("the owner confirms a Seal rotation on their Vault");
      return vaultCall(vault, "confirmSealRotation", [{ oldSeal: getAddress(m.oldSeal!), newSeal: getAddress(m.newSeal!), nonce: BigInt(m.nonce!) }, sig]);
    case "cancel": {
      const sealed = decodeSealedInvoice(m.envelope!);
      const inv = deriveInvoice(sealed.document);
      return ledgerCall(d.ledger, "cancel", [{ ...inv, earlyPay: [...inv.earlyPay] }, sealed.signature, sig]);
    }
    case "credit_note": {
      const sealed = decodeSealedInvoice(m.envelope!);
      const inv = deriveInvoice(sealed.document);
      const note = { fingerprint: m.fingerprint as Hex, amount: BigInt(m.amount!), documentHash: m.documentHash as Hex, nonce: BigInt(m.nonce!) };
      return ledgerCall(d.ledger, "applyCreditNote", [{ ...inv, earlyPay: [...inv.earlyPay] }, sealed.signature, note, sig]);
    }
    default:
      throw new Error(`unknown request kind ${r.kind}`);
  }
}
