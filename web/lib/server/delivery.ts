import "server-only";

import { and, eq } from "drizzle-orm";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseEventLogs,
  stringToBytes,
  type Hex,
  type PublicClient,
} from "viem";
import { verifySealedInvoice } from "@symbolon/seal";
import { invoiceStatus, symbolonContracts, symbolonVaultAbi, type Deployment } from "@symbolon/chain";
import { deliveryConfirmCall, deliveryRejectCall, recordDeliveryOutcome } from "@symbolon/core";
import { businesses, decisions, deliveries, invoices, users, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { ChainSettings } from "./business";
import type { SessionUser } from "./session";
import { UNSAFE_TEXT } from "@/lib/text-safety";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 500;

// N8 — who can do it and whether the action would succeed
export async function prepareDelivery(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  body: {
    action: unknown; // "confirm" | "reject"
    fingerprint: unknown;
    reason?: unknown;
  },
) {
  await requireMember(db, user.id, businessId, "owner", "approver", "requester");

  const action = body.action;
  if (action !== "confirm" && action !== "reject") {
    throw new AuthError(400, "Action must be \"confirm\" or \"reject\".");
  }
  if (typeof body.fingerprint !== "string" || !HASH_RE.test(body.fingerprint)) {
    throw new AuthError(400, "That invoice fingerprint is malformed.");
  }
  const fingerprint = body.fingerprint as Hex;

  // Load the invoice and verify its envelope is still intact
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault yet.");
  const vault = getAddress(business.vault);

  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.fingerprint, fingerprint.toLowerCase()), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!inv) throw new AuthError(404, "That invoice doesn't exist in this business.");

  // Verify the stored envelope is still authentic
  const verification = await verifySealedInvoice(inv.envelope, {
    client,
    expected: { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
  });
  if (!verification.ok) {
    throw new AuthError(409, "The stored invoice envelope failed verification. It cannot be acted on.");
  }

  // Status guard: can't confirm/reject paid, cancelled, or already-rejected invoices
  if (["paid", "cancelled", "rejected"].includes(inv.status)) {
    throw new AuthError(409, `This invoice is ${inv.status} and cannot have its delivery changed.`);
  }

  // Live ledger guard: if already paid or cancelled onchain, refuse
  const c = symbolonContracts(client, cfg.deployment);
  let ledgerPaidOrCancelled = false;
  try {
    const ledger = await invoiceStatus(c, fingerprint);
    if (ledger.paid || ledger.cancelled) ledgerPaidOrCancelled = true;
  } catch {
    // Can't confirm live state — refuse on a money path
    throw new AuthError(502, "Can't confirm this invoice's payment state right now. Try again shortly.");
  }
  if (ledgerPaidOrCancelled) {
    throw new AuthError(409, "This invoice has already been settled or cancelled onchain.");
  }

  // Wallet check: user's wallet must be the Vault's owner or an onchain requester (N8)
  const [userRow] = await db
    .select({ wallet: users.wallet })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!userRow?.wallet) {
    throw new AuthError(409, "Your account doesn't have a wallet linked to it yet.");
  }
  const userWallet = getAddress(userRow.wallet);

  let walletIsAuthorised = false;
  try {
    const [onchainOwner, isRequester] = await Promise.all([
      client.readContract({ address: vault, abi: symbolonVaultAbi, functionName: "owner" }),
      c.lens.read.isRequester([vault, userWallet]),
    ]);
    walletIsAuthorised =
      getAddress(onchainOwner as string) === userWallet || (isRequester as boolean);
  } catch {
    throw new AuthError(502, "Can't verify your wallet's onchain role right now. Try again shortly.");
  }
  if (!walletIsAuthorised) {
    throw new AuthError(
      403,
      "Only the Vault's owner or an onchain requester can confirm or reject delivery. Team roles arrive with the team screen.",
    );
  }

  // Check: confirm refuses if already confirmed; reject refuses if already confirmed too (same for simplicity)
  const [existing] = await db
    .select({ state: deliveries.state })
    .from(deliveries)
    .where(
      and(eq(deliveries.businessId, businessId), eq(deliveries.fingerprint, fingerprint.toLowerCase())),
    )
    .limit(1);
  if (action === "confirm" && existing?.state === "confirmed") {
    throw new AuthError(409, "Delivery has already been confirmed for this invoice.");
  }

  if (action === "confirm") {
    const call = deliveryConfirmCall(vault, fingerprint);
    const data = encodeFunctionData({
      abi: symbolonVaultAbi,
      functionName: call.functionName,
      args: call.args,
    });
    return {
      to: call.address,
      data,
      chainId: cfg.chainId,
      action: "confirm" as const,
      fingerprint,
      summary: { action: "Confirm delivery", fingerprint, signerSuffix: userWallet.slice(-6) },
    };
  }

  // action === "reject"
  if (typeof body.reason !== "string" || !body.reason.trim()) {
    throw new AuthError(400, "A rejection reason is required.");
  }
  if (UNSAFE_TEXT.test(body.reason)) {
    throw new AuthError(400, "Rejection reason contains unsafe characters.");
  }
  const reasonTrimmed = body.reason.trim();
  if (reasonTrimmed.length < MIN_REASON_LENGTH) {
    throw new AuthError(400, `Rejection reason must be at least ${MIN_REASON_LENGTH} characters.`);
  }
  if (reasonTrimmed.length > MAX_REASON_LENGTH) {
    throw new AuthError(400, `Rejection reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }

  const { call, reasonHash, reason } = deliveryRejectCall(vault, fingerprint, reasonTrimmed);
  const data = encodeFunctionData({
    abi: symbolonVaultAbi,
    functionName: call.functionName,
    args: call.args,
  });
  return {
    to: call.address,
    data,
    chainId: cfg.chainId,
    action: "reject" as const,
    fingerprint,
    reason,
    reasonHash,
    summary: { action: "Reject delivery", fingerprint, reason, signerSuffix: userWallet.slice(-6) },
  };
}

// N9 — record from a verified receipt
export async function recordDelivery(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  body: {
    action: unknown; // "confirm" | "reject"
    fingerprint: unknown;
    txHash: unknown;
    reason?: unknown; // required for "reject"; must match what was prepared
  },
) {
  await requireMember(db, user.id, businessId, "owner", "approver", "requester");

  const action = body.action;
  if (action !== "confirm" && action !== "reject") {
    throw new AuthError(400, "Action must be \"confirm\" or \"reject\".");
  }
  if (typeof body.fingerprint !== "string" || !HASH_RE.test(body.fingerprint)) {
    throw new AuthError(400, "That invoice fingerprint is malformed.");
  }
  if (typeof body.txHash !== "string" || !HASH_RE.test(body.txHash)) {
    throw new AuthError(400, "That isn't a transaction hash.");
  }

  const fingerprint = body.fingerprint as Hex;
  const txHash = body.txHash as Hex;
  const fp = fingerprint.toLowerCase();

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  const vault = getAddress(business.vault);

  // Get the actor's wallet to verify receipt's `by` field
  const [userRow] = await db
    .select({ wallet: users.wallet })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!userRow?.wallet) throw new AuthError(409, "Your account doesn't have a wallet.");
  const userWallet = getAddress(userRow.wallet);

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    throw new AuthError(409, "That transaction isn't confirmed yet. Try again shortly.");
  }
  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) {
    throw new AuthError(409, "That transaction wasn't a successful call to this Vault.");
  }

  // Idempotency: already recorded with this txHash
  const [alreadyRecorded] = await db
    .select({ state: deliveries.state })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.businessId, businessId),
        eq(deliveries.fingerprint, fp),
        eq(deliveries.txHash!, txHash.toLowerCase()),
      ),
    )
    .limit(1);
  if (alreadyRecorded) return { fingerprint, action, txHash };

  if (action === "confirm") {
    const events = parseEventLogs({
      abi: symbolonVaultAbi,
      eventName: "DeliveryConfirmed",
      logs: receipt.logs,
    }).filter((l) => getAddress(l.address) === vault);
    if (events.length !== 1) {
      throw new AuthError(409, "That receipt didn't confirm exactly one delivery in this Vault.");
    }
    const ev = events[0]!.args;
    if (ev.fingerprint.toLowerCase() !== fp) {
      throw new AuthError(409, "That receipt confirmed a different invoice.");
    }
    if (getAddress(ev.by) !== userWallet) {
      throw new AuthError(409, "That receipt was signed by a different wallet.");
    }

    // Re-read lens to confirm
    const c = symbolonContracts(client, cfg.deployment);
    const confirmed = await c.lens.read.deliveryConfirmed([vault, fingerprint]).catch(() => false);
    if (!confirmed) {
      throw new AuthError(502, "The Vault doesn't show delivery as confirmed yet. Try again shortly.");
    }

    // Write: upsert delivery row, release human hold if present
    await recordDeliveryOutcome(db, {
      businessId,
      fingerprint,
      action: "confirm",
      confirmedBy: user.id,
      txHash: txHash.toLowerCase(),
    });

    await appendAppDecision(db, businessId, {
      kind: "delivery_confirmed",
      subject: fp,
      actor: user.id,
      inputs: { fingerprint: fp, txHash, by: ev.by },
      rule: "verified Vault receipt with DeliveryConfirmed event and lens confirmation",
      outcome: "delivery_confirmed",
    });

  } else {
    // action === "reject"
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      throw new AuthError(400, "Rejection reason is required for a rejection receipt.");
    }
    const reason = body.reason.trim();

    const events = parseEventLogs({
      abi: symbolonVaultAbi,
      eventName: "DeliveryRejected",
      logs: receipt.logs,
    }).filter((l) => getAddress(l.address) === vault);
    if (events.length !== 1) {
      throw new AuthError(409, "That receipt didn't reject exactly one delivery in this Vault.");
    }
    const ev = events[0]!.args;
    if (ev.fingerprint.toLowerCase() !== fp) {
      throw new AuthError(409, "That receipt rejected a different invoice.");
    }
    if (getAddress(ev.by) !== userWallet) {
      throw new AuthError(409, "That receipt was signed by a different wallet.");
    }
    // Verify the reason's hash matches the event
    const expectedReasonHash = keccak256(stringToBytes(reason));
    if (ev.reasonHash !== expectedReasonHash) {
      throw new AuthError(409, "The rejection reason doesn't match the onchain hash. Reopen the rejection flow.");
    }

    // Write: upsert delivery, hold invoice, notify vendor
    await recordDeliveryOutcome(db, {
      businessId,
      fingerprint,
      action: "reject",
      confirmedBy: user.id,
      txHash: txHash.toLowerCase(),
      reason,
      reasonHash: ev.reasonHash,
    });

    await appendAppDecision(db, businessId, {
      kind: "delivery_rejected",
      subject: fp,
      actor: user.id,
      inputs: { fingerprint: fp, reason, reasonHash: ev.reasonHash, txHash, by: ev.by },
      rule: "verified Vault receipt with DeliveryRejected event and matching reason hash",
      outcome: "delivery_rejected",
    });
  }

  return { fingerprint, action, txHash };
}
