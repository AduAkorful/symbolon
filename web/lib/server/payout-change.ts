import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { decodeFunctionData, encodeFunctionData, getAddress, isAddress, parseEventLogs, zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import { getDeployment, symbolonContracts, vaultCall } from "@symbolon/chain";
import { symbolonVaultAbi } from "@symbolon/chain";
import { requestCall, submitVendorRequest } from "@symbolon/core";
import { businesses, decisions, payees, vendorRequests, type Database } from "@symbolon/db";
import { canonicalJson, digest, sealDomain, typedDataJson, verifySealSignature } from "@symbolon/seal";

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
    const contracts = symbolonContracts(client, cfg.deployment);

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
      throw new AuthError(502, "Can't confirm payout records for every business Vault.");
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
      throw new AuthError(502, "Can't confirm payout records for every business Vault.");
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
  const txHash = input.txHash.toLowerCase() as Hex;

  const [req] = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.id, input.requestId), eq(vendorRequests.businessId, businessId)))
    .limit(1);

  if (!req) {
    throw new AuthError(404, "Request not found.");
  }

  if (req.kind !== "payout_change") throw new AuthError(409, "Not a payout change request.");
  const recorded = await recordedPayoutAction(db, businessId, input.requestId, txHash, "payout_change_confirmed");
  if (recorded) return { success: true, activeAt: Number(recorded.activeAt) };
  if (req.status !== "pending") throw new AuthError(409, "Request is no longer pending.");

  const { receipt, vault, contracts, transaction } = await payoutReceipt(db, client, businessId, txHash);
  const message = req.message as { newPayout: string; payoutDomain: number; nonce: string };
  const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: transaction.input });
  if (decoded.functionName !== "confirmPayoutChange") throw new AuthError(409, "Not a payout confirmation.");
  const [change, signature] = decoded.args;
  if (change.seal.toLowerCase() !== req.seal || change.newPayout.toLowerCase() !== message.newPayout.toLowerCase() || change.payoutDomain !== Number(message.payoutDomain) || change.nonce !== BigInt(message.nonce) || signature.toLowerCase() !== req.signature.toLowerCase()) throw new AuthError(409, "Transaction does not match this signed payout request.");
  const logs = parseEventLogs({ abi: symbolonVaultAbi, logs: receipt.logs, eventName: "PayoutChangeConfirmed" }).filter((l) => getAddress(l.address) === vault && l.args.seal.toLowerCase() === req.seal);
  const match = logs[0];
  if (logs.length !== 1 || !match || match.args.newPayout.toLowerCase() !== message.newPayout.toLowerCase() || match.args.payoutDomain !== Number(message.payoutDomain)) throw new AuthError(409, "No matching confirmation from this Vault.");
  const current = await contracts.lens.read.getPayee([vault, getAddress(req.seal)]).catch(() => { throw new AuthError(502, "Can't verify this payout request's current state."); });
  const pendingMatches = current.pendingActiveAt === match.args.activeAt && current.pendingPayout.toLowerCase() === message.newPayout.toLowerCase() && current.pendingDomain === Number(message.payoutDomain);
  const appliedMatches = current.pendingActiveAt === 0n && current.payout.toLowerCase() === message.newPayout.toLowerCase() && current.payoutDomain === Number(message.payoutDomain);
  if (current.lastChangeNonce !== BigInt(message.nonce) || (!pendingMatches && !appliedMatches)) throw new AuthError(409, "Can't confirm this payout request's current state.");
  await db.transaction(async (tx) => {
  const [locked] = await tx.select().from(vendorRequests)
    .where(and(eq(vendorRequests.id, req.id), eq(vendorRequests.businessId, businessId)))
    .for("update");
  if (!locked || locked.kind !== "payout_change" || locked.seal !== req.seal || locked.signature !== req.signature || canonicalJson(locked.message) !== canonicalJson(req.message)) throw new AuthError(409, "The payout request changed during recording.");
  if (await recordedPayoutAction(tx, businessId, req.id, txHash, "payout_change_confirmed")) return;
  if (locked.status !== "pending") throw new AuthError(409, "Request is no longer pending.");
  await tx
    .update(vendorRequests)
    .set({ status: "confirmed" })
    .where(and(eq(vendorRequests.id, req.id), eq(vendorRequests.businessId, businessId), eq(vendorRequests.kind, "payout_change"), eq(vendorRequests.status, "pending")));

  await appendAppDecision(
    tx,
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
    txHash,
  );

  });

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
  const txHash = input.txHash.toLowerCase() as Hex;

  const [req] = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.id, input.requestId), eq(vendorRequests.businessId, businessId)))
    .limit(1);

  if (!req) {
    throw new AuthError(404, "Request not found.");
  }

  if (req.kind !== "payout_change") throw new AuthError(409, "Not a payout change request.");
  if (await recordedPayoutAction(db, businessId, input.requestId, txHash, "payout_change_cancelled")) return { success: true };
  if (req.status !== "confirmed") throw new AuthError(409, "Only a confirmed pending payout change can be cancelled.");

  const { receipt, vault, contracts, transaction } = await payoutReceipt(db, client, businessId, txHash);
  const message = req.message as { newPayout: string; payoutDomain: number; nonce: string };
  const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: transaction.input });
  if (decoded.functionName !== "cancelPayoutChange" || decoded.args[0].toLowerCase() !== req.seal) throw new AuthError(409, "Not this Seal's cancellation.");
  const logs = parseEventLogs({ abi: symbolonVaultAbi, logs: receipt.logs, eventName: "PayoutChangeCancelled" }).filter((l) => getAddress(l.address) === vault && l.args.seal.toLowerCase() === req.seal);
  if (logs.length !== 1 || receipt.blockNumber <= 0n) throw new AuthError(409, "No matching cancellation from this Vault.");
  const [before, current] = await Promise.all([
    contracts.lens.read.getPayee([vault, getAddress(req.seal)], { blockNumber: receipt.blockNumber - 1n }),
    contracts.lens.read.getPayee([vault, getAddress(req.seal)]),
  ]).catch(() => { throw new AuthError(502, "Can't verify this cancellation's payout state."); });
  if (before.lastChangeNonce !== BigInt(message.nonce) || before.pendingPayout.toLowerCase() !== message.newPayout.toLowerCase() || before.pendingDomain !== Number(message.payoutDomain) || before.pendingActiveAt === 0n || current.lastChangeNonce !== BigInt(message.nonce) || current.pendingActiveAt !== 0n) throw new AuthError(409, "Cancellation does not match this payout request.");
  await db.transaction(async (tx) => {
  const [locked] = await tx.select().from(vendorRequests)
    .where(and(eq(vendorRequests.id, req.id), eq(vendorRequests.businessId, businessId)))
    .for("update");
  if (!locked || locked.kind !== "payout_change" || locked.seal !== req.seal || locked.signature !== req.signature || canonicalJson(locked.message) !== canonicalJson(req.message)) throw new AuthError(409, "The payout request changed during recording.");
  if (await recordedPayoutAction(tx, businessId, req.id, txHash, "payout_change_cancelled")) return;
  if (locked.status !== "confirmed") throw new AuthError(409, "Only a confirmed pending payout change can be cancelled.");
  await tx
    .update(vendorRequests)
    .set({ status: "cancelled" })
    .where(and(eq(vendorRequests.id, req.id), eq(vendorRequests.businessId, businessId), eq(vendorRequests.kind, "payout_change"), eq(vendorRequests.status, "confirmed")));

  await appendAppDecision(
    tx,
    businessId,
    {
      kind: "payout_change_cancelled",
      subject: req.seal,
      actor: user.id,
      inputs: { requestId: input.requestId },
      rule: "owner_cancelled",
      outcome: "cancelled",
    },
    txHash,
  );

  });

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

/** Successful receipt, calldata and state always refer to this business's actual Vault. */
async function payoutReceipt(db: Database, client: PublicClient, businessId: string, txHash: Hex) {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business?.vault) throw new AuthError(409, "Business has no Vault.");
  const vault = getAddress(business.vault);
  const [receipt, transaction] = await Promise.all([client.waitForTransactionReceipt({ hash: txHash }), client.getTransaction({ hash: txHash })]);
  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) throw new AuthError(409, "Not a successful transaction to this Vault.");
  return { receipt, transaction, vault, contracts: symbolonContracts(client, getDeployment(business.chainId)) };
}

/** A previously verified receipt is idempotent only for its recorded request. */
async function recordedPayoutAction(db: Pick<Database, "select">, businessId: string, requestId: string, txHash: Hex, kind: string) {
  const [recorded] = await db.select().from(decisions).where(and(eq(decisions.businessId, businessId), eq(decisions.txHash, txHash.toLowerCase()), eq(decisions.kind, kind)));
  if (!recorded) return undefined;
  const inputs = (recorded.record as { inputs?: Record<string, unknown> }).inputs;
  if (inputs?.requestId !== requestId) throw new AuthError(409, "Receipt already belongs to another payout request.");
  return inputs;
}
