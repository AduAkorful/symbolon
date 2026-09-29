import "server-only";
import { resolve } from "node:path";
import { createDb, createLocalDb, type Database } from "@symbolon/db";
import { getConfig } from "./config";

const g = globalThis as { __symbolonDb?: Promise<Database> };

async function open(): Promise<Database> {
  const config = getConfig();
  if (config.databaseUrl) return createDb(config.databaseUrl);
  // loadConfig already refuses a missing DATABASE_URL in production; this keeps the fallback development-only even if that changes
  if (config.production) throw new Error("DATABASE_URL is not set");
  return createLocalDb(resolve(process.cwd(), ".data/pglite"));
}

/** The app's database: Postgres at DATABASE_URL, or an on-disk PGlite in development. One connection per server process. */
export function getDb(): Promise<Database> {
  const opening = (g.__symbolonDb ??= open());
  // a failed open must not be cached, or every later request would fail the same way
  opening.catch(() => {
    if (g.__symbolonDb === opening) g.__symbolonDb = undefined;
  });
  return opening;
}
