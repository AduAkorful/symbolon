import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { getAddress, type Hex, type PublicClient } from "viem";

import { anchorDecisions } from "@symbolon/core";
import { businesses, decisionAnchors, decisions, type Database } from "@symbolon/db";
import { buildTree, proofFor, verifyProof } from "@symbolon/steward";

import { requireMember } from "./access";
import { AuthError } from "./errors";
import { feeBalance, resolveStewardWallet, type StewardConfig } from "./steward-runtime";

/** Minimum decisions pending to trigger auto-anchoring in scheduled runs (Decision A10 / Q3) */
export const ANCHOR_BATCH_MIN = 5;

export interface DecisionAnchorInfo {
  status: "anchored" | "pending";
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
  if (bal === null || bal === 0n) {
    throw new AuthError(
      400,
      "The Steward wallet has zero network fee balance. Fund it with network fees first to anchor decisions.",
    );
  }

  const result = await anchorDecisions(db, businessId, wallet);
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
  _client: PublicClient,
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
    const tree = buildTree(leaves);
    const proof = proofFor(tree, idx);
    const proofValid = verifyProof(proof, batch.root as Hex, decisionHash);

    return {
      status: "anchored",
      root: batch.root,
      count: batch.count,
      txHash: batch.txHash ?? undefined,
      blockTime: batch.createdAt,
      proofValid,
      proof,
    };
  } catch (err) {
    console.error("Failed building Merkle proof for decision:", err);
    return {
      status: "anchored",
      root: batch.root,
      count: batch.count,
      txHash: batch.txHash ?? undefined,
      blockTime: batch.createdAt,
      proofValid: false,
    };
  }
}
