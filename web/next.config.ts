import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One env file for the whole repo (the root .env, documented in the root .env.example); Next only reads its own folder.
// forceReload: Next has already loaded (and cached) this folder's env by the time the config runs.
loadEnvConfig(resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", console, true);

// Stay outside the bundle: PGlite (the on-disk development database) loads its own WebAssembly, and @symbolon/db finds its
// migration files next to its own build (new URL("../drizzle", import.meta.url)), which a bundler can't follow.
const config: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@electric-sql/pglite", "@symbolon/db"],
};

export default config;
