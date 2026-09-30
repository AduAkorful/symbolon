import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { encodeFunctionData, getAddress, isAddress, parseEventLogs, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { symbolonContracts, vaultCall } from "@symbolon/chain";
import { symbolonVaultAbi } from "@symbolon/chain";
import { requestCall, submitVendorRequest } from "@symbolon/core";
import { businesses, payees, vendorRequests, type Database } from "@symbolon/db";
import { digest, sealDomain, typedDataJson, verifySealSignature } from "@symbolon/seal";

import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { AppConfig } from "./load-config";
import type { SessionUser } from "./session";
import { requireMySeal } from "./vendor";

export interface PayoutChangeRequestItem {
  id: string;
  seal: string;
  newPayout: string;
  payoutDomain: number;
  nonce: string;
  status: "pending" | "confirmed" | "rejected" | "cancelled";
  createdAt: string;
  pendingActiveAt?: number;
}

/**
 * Prepares the PayoutChange typed data for vendor to sign (Plan 05q, Decision V7).
 */
export async function prepareVendorPayoutChange(
  db: Database,
  client: PublicClient,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  input: {
    newPayout: unknown;
    payoutDomain?: unknown;
  },
) {
  const seal = await requireMySeal(db, user.id);

  if (typeof input.newPayout !== "string" || !isAddress(input.newPayout)) {
    throw new AuthError(400, "That isn't a valid payout address.");
  }
  const newPayout = getAddress(input.newPayout);
  if (newPayout === zeroAddress) {
    throw new AuthError(400, "Payout address cannot be the zero address.");
  }

  const payoutDomain = typeof input.payoutDomain === "number" ? input.payoutDomain : 0;
  if (!Number.isInteger(payoutDomain) || payoutDomain < 0) {
    throw new AuthError(400, "Invalid payout domain.");
  }

  // Find all businesses where this vendor is an active onchain payee
  const payeeRows = await db
    .select({
      businessId: payees.businessId,
      businessName: businesses.name,
      vault: businesses.vault,
    })
    .from(payees)
    .innerJoin(businesses, eq(businesses.id, payees.businessId))
    .where(and(eq(payees.seal, seal.address.toLowerCase())));

  const activeBusinesses: { id: string; name: string; vault: Address; lastNonce: bigint }[] = [];

  for (const row of payeeRows) {
    if (!row.vault) continue;
    const vaultAddr = getAddress(row.vault);
    const contracts = symbolonContracts(client, {
      chainId: cfg.chainId,
      contracts: { symbolonVault: vaultAddr },
    } as any);

    try {
      const p = await contracts.lens.read.getPayee([vaultAddr, getAddress(seal.address)]);
      if (p.exists) {
        activeBusinesses.push({
          id: row.businessId,
          name: row.businessName,
          vault: vaultAddr,
          lastNonce: p.lastChangeNonce,
        });
      }
    } catch {
      // Ignore reading failure for an individual vault
    }
  }

  if (activeBusinesses.length === 0) {
    throw new AuthError(400, "You are not an active payee on any business Vault.");
  }

  const maxLastNonce = activeBusinesses.reduce((max, b) => (b.lastNonce > max ? b.lastNonce : max), 0n);
  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const nonce = nowSecs > maxLastNonce ? nowSecs : maxLastNonce + 1n;

  const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
  const typedData = typedDataJson(domain, "PayoutChange", {
    seal: getAddress(seal.address),
    newPayout,
    payoutDomain,
    nonce,
  });

  return {
    typedData,
    seal: seal.address,
    newPayout,
    payoutDomain,
    nonce: nonce.toString(),
    businesses: activeBusinesses.map((b) => ({ id: b.id, name: b.name, vault: b.vault })),
  };
}

/**
 * Submits the vendor-signed PayoutChange, fanning out across all verified businesses (Decision V8).
 */
export async function submitVendorPayoutChange(
  db: Database,
  client: PublicClient,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  input: {
    newPayout: unknown;
    payoutDomain: unknown;
    nonce: unknown;
    signature: unknown;
  },
) {
  const seal = await requireMySeal(db, user.id);

  if (typeof input.newPayout !== "string" || !isAddress(input.newPayout)) {
    throw new AuthError(400, "Invalid new payout address.");
  }
  const newPayout = getAddress(input.newPayout);

  const payoutDomain = Number(input.payoutDomain);
  const nonce = BigInt(String(input.nonce));

  if (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(input.signature)) {
    throw new AuthError(400, "Invalid signature.");
  }
  const signature = input.signature.toLowerCase() as Hex;

  // Verify signature
  const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
  const dg = digest(domain, "PayoutChange", {
    seal: getAddress(seal.address),
    newPayout,
    payoutDomain,
    nonce,
  });

  const check = await verifySealSignature({
    signer: getAddress(seal.address),
    digest: dg,
    signature,
    client: client as any,
  });
  if (!check.valid) {
    throw new AuthError(400, `Signature rejected: ${check.reason}`);
  }

  // Find all active onchain businesses for this seal
  const payeeRows = await db
    .select({
      businessId: payees.businessId,
      vault: businesses.vault,
    })
    .from(payees)
    .innerJoin(businesses, eq(businesses.id, payees.businessId))
    .where(eq(payees.seal, seal.address.toLowerCase()));

  const targetBusinesses: string[] = [];
  for (const row of payeeRows) {
    if (!row.vault) continue;
    const vaultAddr = getAddress(row.vault);
    const contracts = symbolonContracts(client, cfg.deployment);

    try {
      const p = await contracts.lens.read.getPayee([vaultAddr, getAddress(seal.address)]);
      if (p.exists && nonce > p.lastChangeNonce) {
        targetBusinesses.push(row.businessId);
      }
    } catch {
      // Ignore
    }
  }

  if (targetBusinesses.length === 0) {
    throw new AuthError(400, "No business Vaults are eligible for this payout change nonce.");
  }

  const createdIds: string[] = [];
  for (const businessId of targetBusinesses) {
    const res = await submitVendorRequest(
      db,
      { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
      businessId,
      {
        kind: "payout_change",
        message: {
          seal: getAddress(seal.address),
          newPayout,
          payoutDomain,
          nonce,
        },
      },
      signature,
      { client: client as any },
    );
    createdIds.push(res.id);
  }

  return { success: true, count: createdIds.length, requestIds: createdIds };
}

/**
 * Lists vendor requests for a business.
 */
export async function listVendorRequests(
  db: Database,
  businessId: string,
): Promise<PayoutChangeRequestItem[]> {
  const rows = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.businessId, businessId), eq(vendorRequests.kind, "payout_change")))
    .orderBy(desc(vendorRequests.createdAt));

  return rows.map((r) => {
    const m = r.message as Record<string, unknown>;
    return {
      id: r.id,
      seal: r.seal,
      newPayout: String(m.newPayout ?? ""),
      payoutDomain: Number(m.payoutDomain ?? 0),
      nonce: String(m.nonce ?? ""),
      status: r.status as PayoutChangeRequestItem["status"],
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/**
 * Prepares the owner-signed confirmPayoutChange call (Decision V9a).
 */
export async function prepareConfirmPayoutChange(
  db: Database,
  cfg: Pick<AppConfig, "deployment">,
  user: Pick<SessionUser, "id">,
  businessId: string,
  requestId: string,
) {
  await requireMember(db, user.id, businessId, "owner");

  const [req] = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.id, requestId), eq(vendorRequests.businessId, businessId)))
    .limit(1);

  if (!req || req.kind !== "payout_change") {
    throw new AuthError(404, "Payout change request not found.");
  }
  if (req.status !== "pending") {
    throw new AuthError(400, "Request is no longer pending.");
  }

  const [biz] = await db
    .select({ vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!biz?.vault) {
    throw new AuthError(409, "Business has no Vault.");
  }

  const call = await requestCall(
    db,
    { chainId: cfg.deployment.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
    requestId,
    getAddress(biz.vault),
  );
  return {
    to: call.address,
    data: encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args as any,
    }),
  };
}

/**
 * Records the confirmed payout change from transaction receipt.
 */
export async function recordConfirmPayoutChange(
  db: Database,
  client: PublicClient,
  user: Pick<SessionUser, "id">,
  businessId: string,
  input: {
    requestId: string;
    txHash: Hex;
  },
) {
  await requireMember(db, user.id, businessId, "owner");

  const [req] = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.id, input.requestId), eq(vendorRequests.businessId, businessId)))
    .limit(1);

  if (!req) {
    throw new AuthError(404, "Request not found.");
  }

  const receipt = await client.waitForTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== "success") {
    throw new AuthError(400, "Transaction failed onchain.");
  }

  const logs = parseEventLogs({
    abi: symbolonVaultAbi,
    logs: receipt.logs,
    eventName: "PayoutChangeConfirmed",
  });

  const match = logs.find(
    (l) => l.args.seal.toLowerCase() === req.seal.toLowerCase(),
  );
  if (!match) {
    throw new AuthError(400, "No PayoutChangeConfirmed event found for this Seal in the transaction.");
  }

  await db
    .update(vendorRequests)
    .set({ status: "confirmed" })
    .where(eq(vendorRequests.id, input.requestId));

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "payout_change_confirmed",
      subject: req.seal,
      actor: user.id,
      inputs: {
        requestId: input.requestId,
        newPayout: match.args.newPayout,
        payoutDomain: match.args.payoutDomain,
        activeAt: Number(match.args.activeAt),
      },
      rule: "owner_confirmed",
      outcome: "confirmed",
    },
    input.txHash,
  );

  return { success: true, activeAt: Number(match.args.activeAt) };
}

/**
 * Prepares the cancelPayoutChange call (only while change is pending).
 */
export async function prepareCancelPayoutChange(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  requestId: string,
) {
  await requireMember(db, user.id, businessId, "owner");

  const [req] = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.id, requestId), eq(vendorRequests.businessId, businessId)))
    .limit(1);

  if (!req) {
    throw new AuthError(404, "Request not found.");
  }

  const [biz] = await db
    .select({ vault: businesses.vault })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!biz?.vault) {
    throw new AuthError(409, "Business has no Vault.");
  }

  const call = vaultCall(getAddress(biz.vault), "cancelPayoutChange", [getAddress(req.seal)]);
  return {
    to: call.address,
    data: encodeFunctionData({
      abi: call.abi,
      functionName: call.functionName,
      args: call.args as any,
    }),
  };
}

/**
 * Records the cancelled payout change.
 */
export async function recordCancelPayoutChange(
  db: Database,
  client: PublicClient,
  user: Pick<SessionUser, "id">,
  businessId: string,
  input: {
    requestId: string;
    txHash: Hex;
  },
) {
  await requireMember(db, user.id, businessId, "owner");

  const [req] = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.id, input.requestId), eq(vendorRequests.businessId, businessId)))
    .limit(1);

  if (!req) {
    throw new AuthError(404, "Request not found.");
  }

  const receipt = await client.waitForTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== "success") {
    throw new AuthError(400, "Transaction failed onchain.");
  }

  const logs = parseEventLogs({
    abi: symbolonVaultAbi,
    logs: receipt.logs,
    eventName: "PayoutChangeCancelled",
  });

  const match = logs.find(
    (l) => l.args.seal.toLowerCase() === req.seal.toLowerCase(),
  );
  if (!match) {
    throw new AuthError(400, "No PayoutChangeCancelled event found for this Seal in the transaction.");
  }

  await db
    .update(vendorRequests)
    .set({ status: "cancelled" })
    .where(eq(vendorRequests.id, input.requestId));

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "payout_change_cancelled",
      subject: req.seal,
      actor: user.id,
      inputs: { requestId: input.requestId },
      rule: "owner_cancelled",
      outcome: "cancelled",
    },
    input.txHash,
  );

  return { success: true };
}

/**
 * Rejects a payout change request offchain.
 */
export async function rejectPayoutChangeRequest(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  requestId: string,
  reason?: string,
) {
  await requireMember(db, user.id, businessId, "owner", "approver");

  const [req] = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.id, requestId), eq(vendorRequests.businessId, businessId)))
    .limit(1);

  if (!req) {
    throw new AuthError(404, "Request not found.");
  }
  if (req.status !== "pending") {
    throw new AuthError(400, "Request is no longer pending.");
  }

  await db
    .update(vendorRequests)
    .set({ status: "rejected" })
    .where(eq(vendorRequests.id, requestId));

  await appendAppDecision(db, businessId, {
    kind: "payout_change_rejected",
    subject: req.seal,
    actor: user.id,
    inputs: { requestId, ...(reason ? { reason } : {}) },
    rule: "human_review",
    outcome: "rejected",
  });

  return { success: true };
}
