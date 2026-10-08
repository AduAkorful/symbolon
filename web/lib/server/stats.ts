import "server-only";

import { and, count, countDistinct, eq, inArray, isNull, min, sql } from "drizzle-orm";
import { formatUnits, type PublicClient } from "viem";
import { arcChain, type Deployment } from "@symbolon/chain";
import { protocolStreams } from "@symbolon/core";
import { chainEvents, syncCursors, type Database } from "@symbolon/db";

/** The network-wide numbers (plan 05zc §2). Only what Arc itself shows, read from the event mirror, with the network and block named. */

/** How far behind the chain's head the mirror may be and still be called collected: about three hours of Arc blocks */
export const COLLECTED_WITHIN_BLOCKS = 20_000n;

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
}

export interface ProtocolStats {
  network: { name: string; chainId: number; testnet: boolean };
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
  const base = { network, readThrough: readThrough?.toString() ?? null, head: head?.toString() ?? null };
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
    },
  };
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
