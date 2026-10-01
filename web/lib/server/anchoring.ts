import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { parseEventLogs, getAddress, type Hex, type PublicClient } from "viem";

import { symbolonVaultAbi } from "@symbolon/chain";
import { anchorDecisions } from "@symbolon/core";
import { businesses, decisionAnchors, decisions, type Database } from "@symbolon/db";
import { buildTree, proofFor, verifyProof } from "@symbolon/steward";

import { requireMember } from "./access";
import { AuthError } from "./errors";
import { feeBalance, resolveStewardWallet, type StewardConfig } from "./steward-runtime";

/** Minimum decisions pending to trigger auto-anchoring in scheduled runs (Decision A10 / Q3) */
export const ANCHOR_BATCH_MIN = 5;

export interface DecisionAnchorInfo {
  status: "anchored" | "pending" | "unconfirmed";
  reason?: string;
  root?: string;
  count?: number;
  txHash?: string;
  blockTime?: Date;
  proofValid?: boolean;
  proof?: string[];
}

/**
 * Anchors pending decisions onchain using the Steward's wallet (Decision A10).
 */
export async function anchorPending(
  db: Database,
  client: PublicClient,
  cfg: StewardConfig,
  businessId: string,
  actorUserId: string,
) {
  await requireMember(db, actorUserId, businessId, "owner", "approver");

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.vault) throw new AuthError(409, "This business doesn't have a Vault yet.");
  if (!biz.stewardWallet) throw new AuthError(409, "Steward wallet is not provisioned for this business.");

  const wallet = await resolveStewardWallet(client, cfg, biz);
  if (!wallet) {
    throw new AuthError(
      503,
      "Steward wallet service (Circle) is not configured in this environment.",
    );
  }

  const bal = await feeBalance(client, biz.stewardWallet);
  if (bal === null) throw new AuthError(502, "Can't confirm the Steward wallet's network fee balance.");
  if (bal === 0n) {
    throw new AuthError(
      400,
      "The Steward wallet has zero network fee balance. Fund it with network fees first to anchor decisions.",
    );
  }

  const result = await anchorDecisions(db, businessId, wallet, { client });
  if (!result) {
    return { ok: true, count: 0, message: "No decisions pending anchoring." };
  }

  return {
    ok: true,
    root: result.root,
    count: result.count,
    txHash: result.txHash,
  };
}

/**
 * Returns the anchor status and Merkle proof for a decision record (Decision A9 & A10).
 */
export async function anchorState(
  db: Database,
  client: PublicClient,
  _cfg: StewardConfig,
  businessId: string,
  decisionHash: Hex,
): Promise<DecisionAnchorInfo> {
  const normHash = decisionHash.toLowerCase();

  // Find the anchor batch containing this decision hash
  const batches = await db
    .select()
    .from(decisionAnchors)
    .where(eq(decisionAnchors.businessId, businessId))
    .orderBy(desc(decisionAnchors.createdAt));

  const batch = batches.find((b) =>
    Array.isArray(b.leaves) && b.leaves.some((l) => l.toLowerCase() === normHash),
  );

  if (!batch) {
    return { status: "pending" };
  }

  const leaves = batch.leaves as Hex[];
  const idx = leaves.findIndex((l) => l.toLowerCase() === normHash);
  if (idx === -1) return { status: "pending" };

  try {
    if (!batch.txHash) return { status: "unconfirmed", reason: "This local batch has no confirmed chain transaction." };
    const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    if (!business?.vault) return { status: "unconfirmed", reason: "The business Vault cannot be confirmed." };
    const vault = getAddress(business.vault);
    const receipt = await client.getTransactionReceipt({ hash: batch.txHash as Hex });
    if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) return { status: "unconfirmed", reason: "The anchor transaction is not confirmed for this Vault." };
    const events = parseEventLogs({ abi: symbolonVaultAbi, logs: receipt.logs, eventName: "DecisionsAnchored" }).filter((l) => getAddress(l.address) === vault && l.args.root.toLowerCase() === batch.root.toLowerCase() && l.args.count === BigInt(batch.count));
    if (events.length !== 1 || leaves.length !== batch.count) return { status: "unconfirmed", reason: "The matching Vault anchor event cannot be confirmed." };
    const tree = buildTree(leaves);
    const proof = proofFor(tree, idx);
    const proofValid = tree.root.toLowerCase() === batch.root.toLowerCase() && verifyProof(proof, batch.root as Hex, decisionHash);
    if (!proofValid) return { status: "unconfirmed", reason: "The decision's inclusion in the confirmed root cannot be verified." };
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    return { status: "anchored", root: batch.root, count: batch.count, txHash: batch.txHash, blockTime: new Date(Number(block.timestamp) * 1000), proofValid, proof };
  } catch {
    return { status: "unconfirmed", reason: "Can't verify the onchain anchor and block time right now." };
  }
}
