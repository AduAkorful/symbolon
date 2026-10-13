import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getAddress, parseAbiItem, type Address, type PublicClient } from "viem";

import { scanLogs, type Deployment } from "@symbolon/chain";
import { decisions, syncCursors, type Database } from "@symbolon/db";
import { hashRecord, type DecisionRecord } from "@symbolon/steward";

import { CHAIN_READ_DEADLINE_MS, withDeadline } from "./deadline";
import { ensureVaultBlock } from "./business";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** Blocks read per view: Arc's public RPCs give ~5,000 per log request, so this is a dozen requests and never the whole history */
const WINDOW = 60_000n;

/**
 * Records the token deposits into a Vault that the app never saw (plan 05zl 1.3, QA Still-broken 6). A token transfer into the
 * Vault emits nothing the Vault itself syncs, and `recordDeposit` writes a record only when the app sees the receipt, so earlier
 * deposits (and ones sent from a wallet outside the app) were missing from Activity. This reads the token contract's own
 * `Transfer` logs addressed to this Vault, one bounded window per call from a per-Vault cursor, and writes the same
 * `deposit_confirmed` record, dated by the block's own time. It writes no notification: these are history, not news.
 *
 * Only the token contract's log counts: Arc emits a second, system `Transfer` for every USDC move (it is filtered out by the
 * emitting address). Failures are logged and leave the cursor where it was.
 */
export async function backfillDeposits(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  businessId: string,
  vault: Address,
): Promise<void> {
  const key = `deposits:${deployment.chainId}:${vault.toLowerCase()}`;
  try {
    const [cursor] = await db.select().from(syncCursors).where(eq(syncCursors.key, key));
    const start = await ensureVaultBlock(db, client, deployment, businessId, vault);
    const from = cursor ? cursor.block + 1n : start;
    const head = await client.getBlockNumber();
    if (from > head) return;
    const to = from + WINDOW - 1n < head ? from + WINDOW - 1n : head;

    const tokens = [
      { symbol: "USDC", address: getAddress(deployment.tokens.usdc) },
      { symbol: "EURC", address: getAddress(deployment.tokens.eurc) },
    ];
    const found: { symbol: string; txHash: string; from: string; value: bigint; block: bigint }[] = [];
    for (const token of tokens) {
      const { logs } = await withDeadline(
        scanLogs(client, { address: token.address, events: [TRANSFER], fromBlock: from, toBlock: to, args: { to: vault }, concurrency: 2 }),
        4 * CHAIN_READ_DEADLINE_MS,
        "Reading deposits",
      );
      for (const l of logs) {
        if (!l.transactionHash || l.blockNumber === null || l.blockNumber === undefined) continue;
        found.push({ symbol: token.symbol, txHash: l.transactionHash.toLowerCase(), from: getAddress(l.args.from!), value: l.args.value!, block: l.blockNumber });
      }
    }

    if (found.length > 0) {
      const known = await db
        .select({ txHash: decisions.txHash })
        .from(decisions)
        .where(and(eq(decisions.businessId, businessId), eq(decisions.kind, "deposit_confirmed"), inArray(decisions.txHash, found.map((f) => f.txHash as `0x${string}`))));
      const seen = new Set(known.map((k) => k.txHash?.toLowerCase()));
      for (const f of found) {
        if (seen.has(f.txHash)) continue;
        seen.add(f.txHash);
        const at = new Date(Number((await client.getBlock({ blockNumber: f.block })).timestamp) * 1000);
        const record: DecisionRecord = {
          version: 1,
          kind: "deposit_confirmed",
          business: businessId,
          subject: vault.toLowerCase(),
          at: at.toISOString(),
          mode: "assist",
          inputs: { txHash: f.txHash, token: f.symbol, amount: f.value.toString(), from: f.from, actor: "chain", block: f.block.toString() },
          options: [],
          rule: "the token's own Transfer log into this Vault, read from the chain",
          outcome: "deposited",
        };
        const { hash } = hashRecord(record);
        await db
          .insert(decisions)
          .values({ businessId, kind: "deposit_confirmed", subject: vault.toLowerCase(), record: record as unknown as Record<string, unknown>, hash, txHash: f.txHash as `0x${string}`, createdAt: at })
          .onConflictDoNothing();
      }
    }

    await db
      .insert(syncCursors)
      .values({ key, chainId: deployment.chainId, block: to })
      .onConflictDoUpdate({ target: syncCursors.key, set: { block: to, updatedAt: new Date() } });
  } catch (e) {
    console.error("deposits: reading earlier deposits failed", e);
  }
}
