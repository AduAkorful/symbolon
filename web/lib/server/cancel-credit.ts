import "server-only";

import { eq } from "drizzle-orm";
import { encodeFunctionData, getAddress, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";

import { invoiceLedgerAbi, symbolonContracts } from "@symbolon/chain";
import { requestCall, submitVendorRequest, syncLedger } from "@symbolon/core";
import { invoices, vendorRequests, type Database } from "@symbolon/db";
import { digest, sealDomain, typedDataJson, verifySealSignature } from "@symbolon/seal";

import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { AppConfig } from "./load-config";
import type { SessionUser } from "./session";
import { requireMySeal } from "./vendor";

/**
 * Prepares the Cancel typed data for a vendor to sign (Plan 05q, Decision V10).
 */
export async function prepareCancel(
  db: Database,
  client: PublicClient,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  fingerprintValue: unknown,
) {
  const seal = await requireMySeal(db, user.id);

  if (typeof fingerprintValue !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(fingerprintValue)) {
    throw new AuthError(400, "Invalid invoice fingerprint.");
  }
  const fingerprint = fingerprintValue.toLowerCase() as Hex;

  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.fingerprint, fingerprint))
    .limit(1);

  if (!inv) {
    throw new AuthError(404, "Invoice not found.");
  }
  if (inv.seal.toLowerCase() !== seal.address.toLowerCase()) {
    throw new AuthError(403, "You can only cancel your own invoices.");
  }

  // Check ledger onchain status
  const contracts = symbolonContracts(client, cfg.deployment);

  let state;
  try {
    state = await contracts.ledger.read.status([fingerprint]);
  } catch (err) {
    throw new AuthError(502, "Unable to check invoice status on the ledger right now.");
  }

  if (state.cancelled) {
    throw new AuthError(400, "This invoice is already cancelled on the ledger.");
  }
  if (state.credited > 0n) {
    throw new AuthError(400, "An invoice that has received partial payment cannot be cancelled.");
  }

  const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
  const typedData = typedDataJson(domain, "Cancel", {
    fingerprint,
  });

  return {
    typedData,
    fingerprint,
  };
}

/**
 * Submits the vendor's signed Cancel request and returns the onchain ledger call data (Decision V10).
 */
export async function submitCancel(
  db: Database,
  client: PublicClient,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  input: {
    fingerprint: unknown;
    signature: unknown;
  },
) {
  const seal = await requireMySeal(db, user.id);

  if (typeof input.fingerprint !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.fingerprint)) {
    throw new AuthError(400, "Invalid fingerprint.");
  }
  const fingerprint = input.fingerprint.toLowerCase() as Hex;

  if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(input.signature)) {
    throw new AuthError(400, "Invalid signature.");
  }
  const signature = input.signature.toLowerCase() as Hex;

  const [inv] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.fingerprint, fingerprint))
    .limit(1);

  if (!inv) {
    throw new AuthError(404, "Invoice not found.");
  }
  if (inv.seal.toLowerCase() !== seal.address.toLowerCase()) {
    throw new AuthError(403, "You can only cancel your own invoices.");
  }

  // Verify cancel signature
  const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
  const dg = digest(domain, "Cancel", { fingerprint });
  const check = await verifySealSignature({
    signer: getAddress(seal.address),
    digest: dg,
    signature,
    client: client as any,
  });
  if (!check.valid) {
    throw new AuthError(400, `Signature rejected: ${check.reason}`);
  }

  const res = await submitVendorRequest(
    db,
    { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
    inv.businessId ?? undefined,
    {
      kind: "cancel",
      envelope: inv.envelope,
    },
    signature,
    { client: client as any },
  );

  const call = await requestCall(
    db,
    { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
    res.id,
  );
  return {
    requestId: res.id,
    to: call.address,
    data: encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args as any,
    }),
  };
}

/**
 * Records the onchain cancellation after the ledger transaction succeeds.
 */
export async function recordCancelled(
  db: Database,
  client: PublicClient,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  input: {
    requestId: string;
    txHash: Hex;
  },
) {
  const [req] = await db
    .select()
    .from(vendorRequests)
    .where(eq(vendorRequests.id, input.requestId))
    .limit(1);

  if (!req || req.kind !== "cancel") {
    throw new AuthError(404, "Cancel request not found.");
  }

  const receipt = await client.waitForTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== "success") {
    throw new AuthError(400, "Cancel transaction failed onchain.");
  }

  const logs = parseEventLogs({
    abi: invoiceLedgerAbi,
    logs: receipt.logs,
    eventName: "Cancelled",
  });

  const match = logs.find(
    (l) => req.fingerprint && l.args.fingerprint.toLowerCase() === req.fingerprint.toLowerCase(),
  );
  if (!match) {
    throw new AuthError(400, "No matching Cancelled event found in the transaction receipt.");
  }

  // Sync ledger so invoice status is updated from chain truth
  const contracts = symbolonContracts(client, cfg.deployment);

  await syncLedger(db, client, contracts, cfg.deployment, { toBlock: receipt.blockNumber });

  await db
    .update(vendorRequests)
    .set({ status: "confirmed" })
    .where(eq(vendorRequests.id, input.requestId));

  if (req.businessId) {
    await appendAppDecision(
      db,
      req.businessId,
      {
        kind: "invoice_cancelled",
        subject: req.fingerprint ?? undefined,
        actor: user.id,
        inputs: { requestId: input.requestId, fingerprint: req.fingerprint },
        rule: "vendor_cancel",
        outcome: "cancelled",
      },
      input.txHash,
    );
  }

  return { success: true };
}
