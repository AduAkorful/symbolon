import { asc, eq } from "drizzle-orm";
import { getAddress, type Hex } from "viem";

import { vaultCall } from "@symbolon/chain";
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
): Promise<{ root: Hex; count: number; txHash?: Hex } | undefined> {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz?.vault) throw new Error(`business ${businessId} has no Vault yet`);

  const anchored = new Set(
    (await db.select({ leaves: decisionAnchors.leaves }).from(decisionAnchors).where(eq(decisionAnchors.businessId, businessId))).flatMap(
      (a) => a.leaves,
    ),
  );
  const pending = (
    await db.select({ hash: decisions.hash }).from(decisions).where(eq(decisions.businessId, businessId)).orderBy(asc(decisions.createdAt))
  )
    .map((d) => d.hash as Hex)
    .filter((h) => !anchored.has(h));
  if (pending.length === 0) return undefined;

  const tree = buildTree(pending);
  const txHash = wallet ? await wallet.send(vaultCall(getAddress(biz.vault), "anchorDecisions", [tree.root, BigInt(pending.length)])) : undefined;
  await db.insert(decisionAnchors).values({
    root: tree.root,
    businessId,
    count: pending.length,
    leaves: pending,
    ...(txHash ? { txHash: txHash.toLowerCase() } : {}),
  });
  return { root: tree.root, count: pending.length, ...(txHash ? { txHash } : {}) };
}
