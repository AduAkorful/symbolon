import { mkdirSync } from "node:fs";
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

/** An in-process Postgres (PGlite) with every migration applied: for tests and local runs without a server */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db;
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
