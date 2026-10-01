import { and, asc, eq, isNotNull } from "drizzle-orm";
import { parseEventLogs, getAddress, type PublicClient, type Hex } from "viem";

import { symbolonVaultAbi, vaultCall } from "@symbolon/chain";
import { businesses, decisionAnchors, decisions, type Database } from "@symbolon/db";
import { buildTree, type StewardWallet } from "@symbolon/steward";

/**
 * Anchors every not-yet-anchored decision of a business onchain in one batch: Merkle root and count go to
 * `SymbolonVault.anchorDecisions` (steward-only), the leaves are kept so any decision can later be proven. Returns
 * undefined when there's nothing new.
 */
export async function anchorDecisions(
  db: Database,
  businessId: string,
  wallet?: StewardWallet,
  opts?: { dryRun?: boolean; client?: PublicClient },
): Promise<{ root: Hex; count: number; txHash?: Hex } | undefined> {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz?.vault) throw new Error(`business ${businessId} has no Vault yet`);

  if (!wallet && !opts?.dryRun) {
    throw new Error("wallet required for anchoring onchain (set dryRun: true for tests)");
  }

  const anchored = new Set(
    (await db.select({ leaves: decisionAnchors.leaves }).from(decisionAnchors).where(opts?.dryRun ? eq(decisionAnchors.businessId, businessId) : and(eq(decisionAnchors.businessId, businessId), isNotNull(decisionAnchors.txHash)))).flatMap(
      (a) => a.leaves,
    ),
  );
  const pending = (
    await db.select({ hash: decisions.hash }).from(decisions).where(eq(decisions.businessId, businessId)).orderBy(asc(decisions.createdAt))
  )
    .map((d) => d.hash as Hex)
    .filter((h) => !anchored.has(h));
  if (pending.length === 0) return undefined;

  if (wallet && !opts?.client) throw new Error("chain client required to verify anchoring receipt");
  const tree = buildTree(pending);
  const txHash = wallet ? await wallet.send(vaultCall(getAddress(biz.vault), "anchorDecisions", [tree.root, BigInt(pending.length)])) : undefined;
  if (txHash) {
    const receipt = await opts!.client!.waitForTransactionReceipt({ hash: txHash });
    const vault = getAddress(biz.vault);
    const events = parseEventLogs({ abi: symbolonVaultAbi, eventName: "DecisionsAnchored", logs: receipt.logs }).filter((l) => getAddress(l.address) === vault && l.args.root === tree.root && l.args.count === BigInt(pending.length));
    if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault || events.length !== 1) throw new Error("Matching Vault anchor transaction not confirmed");
  }
  const insert = db.insert(decisionAnchors).values({
    root: tree.root,
    businessId,
    count: pending.length,
    leaves: pending,
    ...(txHash ? { txHash: txHash.toLowerCase() } : {}),
  });
  if (txHash) await insert.onConflictDoUpdate({ target: decisionAnchors.root, set: { txHash: txHash.toLowerCase() } });
  else await insert.onConflictDoNothing();
  return { root: tree.root, count: pending.length, ...(txHash ? { txHash } : {}) };
}
