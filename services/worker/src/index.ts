import { pathToFileURL } from "node:url";

import { createArcClient } from "@symbolon/chain";
import { loadConfig } from "@symbolon/config";
import { createDb, type Database } from "@symbolon/db";
import type { PublicClient } from "viem";

import { runIndexerTick } from "./indexer.js";
import { releaseSyncLease, takeSyncLease } from "./lease.js";
import { runStewardTick } from "./steward.js";

/** Pause between a finished pair of ticks. Manual runs wait at most this long. */
const LOOP_PAUSE_MS = 15_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

async function indexerTick(db: Database, client: PublicClient, chainId: number): Promise<void> {
  const cfg = loadConfig(process.env);
  if (!(await takeSyncLease(db, chainId))) {
    console.info("indexer: another tick holds the lease");
    return;
  }
  try {
    const report = await runIndexerTick(db, client, cfg);
    console.info("indexer", JSON.stringify({ done: report.done, behindBlocks: report.behindBlocks.toString() }));
  } finally {
    await releaseSyncLease(db, chainId).catch(() => {});
  }
}

/** Indexer tick, then one Steward pass, until SIGTERM or SIGINT. */
export async function runUntilStop(signal: AbortSignal, db: Database, client: PublicClient, chainId: number): Promise<void> {
  const cfg = loadConfig(process.env);
  while (!signal.aborted) {
    try {
      await indexerTick(db, client, chainId);
    } catch (err) {
      console.error("indexer tick failed", err instanceof Error ? err.message : err);
    }
    if (signal.aborted) break;
    try {
      await runStewardTick(db, client, cfg);
    } catch (err) {
      console.error("steward tick failed", err instanceof Error ? err.message : err);
    }
    await sleep(LOOP_PAUSE_MS, signal);
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  if (!cfg.databaseUrl) throw new Error("DATABASE_URL is not set");
  const db = createDb(cfg.databaseUrl);
  const client = createArcClient(cfg.chainId, cfg.rpcUrl);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.info(`worker: chain ${cfg.chainId}`);
  await runUntilStop(controller.signal, db, client, cfg.chainId);
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
