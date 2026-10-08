import "server-only";

import { and, count, countDistinct, desc, eq, inArray, isNull, min, sql } from "drizzle-orm";
import { erc20Abi, formatUnits, getAddress, type PublicClient } from "viem";
import { arcChain, type Deployment } from "@symbolon/chain";
import { protocolStreams } from "@symbolon/core";
import { chainEvents, syncCursors, type Database } from "@symbolon/db";

/** The network-wide numbers (plan 05zc §2). Only what Arc itself shows, read from the event mirror, with the network and block named. */

/** How far behind the chain's head the mirror may be and still be called collected: about three hours of Arc blocks */
export const COLLECTED_WITHIN_BLOCKS = 20_000n;

/** How many of the most recent settlements the landing page lists (plan 05zg) */
export const LATEST_SHOWN = 5;

/** One settlement as the ledger recorded it; the transaction hash is what makes it checkable on the explorer */
export interface LatestSettlement {
  txHash: string;
  /** ISO time, or null when the block's time is not known */
  at: string | null;
  /** Null for a token the app has no name for: listed, with no amount, never summed */
  token: "USDC" | "EURC" | null;
  /** Exact digits of what was delivered to the vendor, or null with an unnamed token */
  amount: string | null;
  seal: string;
  payer: string;
}

/** What the Vaults hold, token by token (never added together) */
export interface ValueLocked {
  tokens: { token: "USDC" | "EURC"; amount: string }[];
  /** How many Vaults were read */
  vaults: number;
}

export interface ProtocolNumbers {
  vaultsCreated: number;
  invoicesSettled: number;
  /** Per token, never added together */
  volume: { token: "USDC" | "EURC"; amount: string; settled: number }[];
  /** Settlements in a token the app has no name for: counted, not summed */
  otherTokenSettlements: number;
  sealsPaid: number;
  /** Paying addresses that are Vaults a Symbolon factory created */
  payingVaults: number;
  /** ISO time of the earliest settlement, or null when it can't be told */
  firstSettlement: string | null;
  /** Newest first, at most `LATEST_SHOWN` */
  latest: LatestSettlement[];
  /** The tokens held in every Vault a Symbolon factory created, read from Arc just now; null when any read failed (never a partial total) */
  locked: ValueLocked | null;
}

export interface ProtocolStats {
  network: { name: string; chainId: number; testnet: boolean };
  /** The explorer's address, from the registry, for the links under each settlement */
  explorer: string;
  /** Lowest block every stream has been read through; null before anything is read */
  readThrough: string | null;
  head: string | null;
  /** How much of the history has been read, 0–100, while it is being collected; null when unknown */
  progressPercent: number | null;
  /** Null until the mirror has caught up with the chain, so no partial number is ever shown */
  numbers: ProtocolNumbers | null;
  state: "ready" | "collecting" | "unconfirmed";
}

const lowerAddress = sql<string>`lower(${chainEvents.address})`;
// the key names are this file's own constants, written into the SQL text so a grouped expression is one expression
const arg = (name: "token" | "seal" | "payer") => sql<string>`lower(${chainEvents.args}->>'${sql.raw(name)}')`;

export async function loadProtocolStats(db: Database, client: PublicClient | undefined, deployment: Deployment): Promise<ProtocolStats> {
  const chain = arcChain(deployment.chainId);
  const network = { name: chain.name, chainId: deployment.chainId, testnet: Boolean(chain.testnet) };
  const streams = protocolStreams(deployment);

  const cursors = await db.select().from(syncCursors).where(inArray(syncCursors.key, streams.map((s) => s.key)));
  const readThrough = cursors.length === streams.length ? cursors.reduce((low, c) => (c.block < low ? c.block : low), cursors[0]!.block) : null;

  let head: bigint | null = null;
  try {
    head = client ? await client.getBlockNumber() : null;
  } catch {
    head = null;
  }
  const base = { network, explorer: chain.blockExplorers!.default.url, readThrough: readThrough?.toString() ?? null, head: head?.toString() ?? null };
  // each stream starts at its own contract's block; the history is as far along as its slowest stream
  const progressPercent = (() => {
    if (head === null) return null;
    let low = 100;
    for (const stream of streams) {
      const read = cursors.find((c) => c.key === stream.key)?.block ?? stream.startBlock - 1n;
      const total = head - stream.startBlock + 1n;
      const done = read - stream.startBlock + 1n;
      low = Math.min(low, total <= 0n ? 100 : Math.max(0, Math.min(100, Number((done * 100n) / total))));
    }
    return low;
  })();
  if (readThrough === null) return { ...base, progressPercent, numbers: null, state: "collecting" };
  if (head === null) return { ...base, progressPercent, numbers: null, state: "unconfirmed" };
  if (head - readThrough > COLLECTED_WITHIN_BLOCKS) return { ...base, progressPercent, numbers: null, state: "collecting" };

  const ledger = deployment.contracts.invoiceLedger.toLowerCase();
  const factories = streams.filter((s) => s.kind === "factory").map((s) => s.address.toLowerCase());
  const onChain = eq(chainEvents.chainId, deployment.chainId);
  const settled = and(onChain, eq(lowerAddress, ledger), eq(chainEvents.eventName, "Settled"));
  const created = and(onChain, inArray(lowerAddress, factories), eq(chainEvents.eventName, "VaultCreated"));

  const [vaults] = await db.select({ n: count() }).from(chainEvents).where(created);
  const perToken = await db
    .select({ token: arg("token"), n: count(), paid: sql<string>`coalesce(sum((${chainEvents.args}->>'paid')::numeric), 0)::text` })
    .from(chainEvents)
    .where(settled)
    .groupBy(arg("token"));
  const [people] = await db
    .select({
      seals: countDistinct(arg("seal")),
      first: min(chainEvents.blockTime),
    })
    .from(chainEvents)
    .where(settled);
  const [undated] = await db.select({ n: count() }).from(chainEvents).where(and(settled, isNull(chainEvents.blockTime)));
  const [paying] = await db
    .select({ n: countDistinct(arg("payer")) })
    .from(chainEvents)
    .where(and(settled, sql`${arg("payer")} in (select lower(${chainEvents.args}->>'vault') from ${chainEvents} where ${created})`));

  const vaultRows = await db.select({ vault: sql<string>`distinct lower(${chainEvents.args}->>'vault')` }).from(chainEvents).where(created);
  const vaultList = vaultRows.map((r) => r.vault).filter((v): v is string => /^0x[0-9a-f]{40}$/.test(v ?? ""));
  const locked = await readValueLocked(client, deployment, vaultList);

  const known = new Map<string, "USDC" | "EURC">([
    [deployment.tokens.usdc.toLowerCase(), "USDC"],
    [deployment.tokens.eurc.toLowerCase(), "EURC"],
  ]);
  const volume: ProtocolNumbers["volume"] = [];
  let other = 0;
  for (const row of perToken) {
    const name = known.get(row.token);
    if (!name) {
      other += row.n;
      continue;
    }
    // both tokens carry 6 decimals (checked against the registry's tokens by the app's own tests); amounts stay exact digits
    volume.push({ token: name, amount: formatUnits(BigInt(row.paid), 6), settled: row.n });
  }
  volume.sort((a, b) => a.token.localeCompare(b.token));

  const recent = await db
    .select({ txHash: chainEvents.txHash, at: chainEvents.blockTime, args: chainEvents.args })
    .from(chainEvents)
    .where(settled)
    .orderBy(desc(chainEvents.blockNumber), desc(chainEvents.logIndex))
    .limit(LATEST_SHOWN);
  const latest: LatestSettlement[] = recent.map((row) => {
    const name = known.get(String(row.args.token ?? "").toLowerCase()) ?? null;
    return {
      txHash: row.txHash,
      at: row.at ? new Date(row.at).toISOString() : null,
      token: name,
      amount: name ? formatUnits(BigInt(String(row.args.paid ?? "0")), 6) : null,
      seal: String(row.args.seal ?? ""),
      payer: String(row.args.payer ?? ""),
    };
  });

  return {
    ...base,
    progressPercent: 100,
    state: "ready",
    numbers: {
      vaultsCreated: vaults?.n ?? 0,
      invoicesSettled: perToken.reduce((sum, r) => sum + r.n, 0),
      volume,
      otherTokenSettlements: other,
      sealsPaid: people?.seals ?? 0,
      payingVaults: paying?.n ?? 0,
      firstSettlement: (undated?.n ?? 0) === 0 && people?.first ? new Date(people.first).toISOString() : null,
      latest,
      locked,
    },
  };
}

/**
 * What every Vault holds right now, per token: one batched read of each token's `balanceOf` for each Vault (both tokens carry six
 * decimals, checked against the registry by the app's tests). A single failed read gives null, because a total missing one
 * Vault is a wrong number, not a smaller one.
 */
async function readValueLocked(client: PublicClient | undefined, deployment: Deployment, vaults: string[]): Promise<ValueLocked | null> {
  if (!client) return null;
  if (vaults.length === 0) return { tokens: [{ token: "USDC", amount: "0" }, { token: "EURC", amount: "0" }], vaults: 0 };
  const tokens = [
    { token: "USDC" as const, address: deployment.tokens.usdc },
    { token: "EURC" as const, address: deployment.tokens.eurc },
  ];
  try {
    const results = await client.multicall({
      allowFailure: true,
      contracts: tokens.flatMap((t) => vaults.map((v) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [getAddress(v)] as const }))),
    });
    if (results.some((r) => r.status !== "success")) return null;
    return {
      vaults: vaults.length,
      tokens: tokens.map((t, i) => ({
        token: t.token,
        amount: formatUnits(results.slice(i * vaults.length, (i + 1) * vaults.length).reduce((sum, r) => sum + (r.result as bigint), 0n), 6),
      })),
    };
  } catch {
    return null;
  }
}

let cached: { at: number; key: string; value: ProtocolStats } | undefined;
const CACHE_MS = 60_000;

/** The same numbers for the page and the API, recomputed at most once a minute */
export async function protocolStatsCached(db: Database, client: PublicClient | undefined, deployment: Deployment): Promise<ProtocolStats> {
  const key = `${deployment.chainId}`;
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await loadProtocolStats(db, client, deployment);
  cached = { at: Date.now(), key, value };
  return value;
}
