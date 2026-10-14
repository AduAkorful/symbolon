import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

// Found next to this build at run time. Built from parts rather than `new URL("../drizzle", import.meta.url)`, which
// Next's bundler takes for an asset import and fails to resolve when the app imports this package.
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

/** Any Drizzle Postgres database over this schema (a server in production, PGlite in tests) */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Connects to Postgres (DATABASE_URL). Call `migrateDb` once at deploy. */
export function createDb(url: string) {
  return drizzlePostgres(postgres(url, { prepare: false }), { schema });
}

export async function migrateDb(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await migratePostgres(drizzlePostgres(sql), { migrationsFolder: MIGRATIONS });
  } finally {
    await sql.end();
  }
}

const persist = globalThis as typeof globalThis & { __symbolonPgliteSnapshot?: Blob | File };
// Keyed by the newest migration, so a new migration never meets a snapshot cached from before it. Computed on first use and only for
// tests: this module is loaded by the running app, where the migrations folder is not necessarily on disk, and reading it at load
// time took every page down.
let snapDirCache: string | undefined;
function snapDir(): string {
  if (!snapDirCache) {
    let newest = "none";
    try {
      newest = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().at(-1)?.replace(/\W/g, "") ?? "none";
    } catch {
      // no migrations folder here: the snapshot is only ever used in tests, which have one
    }
    snapDirCache = join(tmpdir(), `symbolon-pglite-snap-${newest}`);
  }
  return snapDirCache;
}
const snapData = () => join(snapDir(), "data");
const snapReady = () => join(snapDir(), "ready");
const snapLock = () => join(snapDir(), "lock");

let snapshot: Blob | File | undefined;
let opening: Promise<void> | undefined;

function loadSnapFile() {
  if (!existsSync(snapReady())) return;
  snapshot = new Blob([readFileSync(snapData())]);
  persist.__symbolonPgliteSnapshot = snapshot;
}

async function waitForSnapFile() {
  const deadline = Date.now() + 60_000;
  while (!existsSync(snapReady())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the PGlite test snapshot");
    await new Promise((r) => setTimeout(r, 50));
  }
  loadSnapFile();
}

async function migrateSnapFile() {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  snapshot = await client.dumpDataDir();
  persist.__symbolonPgliteSnapshot = snapshot;
  mkdirSync(snapDir(), { recursive: true });
  writeFileSync(snapData(), Buffer.from(await snapshot.arrayBuffer()));
  writeFileSync(snapReady(), "1");
  await client.close();
}

async function ensureSnapshot() {
  snapshot ??= persist.__symbolonPgliteSnapshot;
  if (snapshot) return;
  loadSnapFile();
  if (snapshot) return;
  opening ??= (async () => {
    mkdirSync(snapDir(), { recursive: true });
    try {
      const fd = openSync(snapLock(), "wx");
      closeSync(fd);
    } catch {
      await waitForSnapFile();
      return;
    }
    await migrateSnapFile();
  })();
  await opening;
  snapshot ??= persist.__symbolonPgliteSnapshot;
}

/**
 * An in-process Postgres (PGlite) with every migration applied. The first call migrates and dumps a snapshot (kept on
 * globalThis so a later isolated file can load it). Later calls clone from that snapshot, so files can run in parallel.
 */
export async function createTestDb() {
  await ensureSnapshot();
  const client = new PGlite({ loadDataDir: snapshot! });
  await client.waitReady;
  return drizzlePglite(client, { schema });
}

/** PGlite kept on disk, for running the app locally without a Postgres server. Never for production data. */
export async function createLocalDb(dataDir: string) {
  // PGlite makes the data folder but not its parents
  mkdirSync(dirname(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db;
}
