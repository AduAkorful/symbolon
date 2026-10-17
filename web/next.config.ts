import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// One env file for the whole repo (the root .env, documented in the root .env.example); Next only reads its own folder.
// forceReload: Next has already loaded (and cached) this folder's env by the time the config runs.
loadEnvConfig(resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", console, true);

// Stay outside the bundle: PGlite (the on-disk development database) loads its own WebAssembly, and @symbolon/db finds its
// migration files next to its own build (new URL("../drizzle", import.meta.url)), which a bundler can't follow.
// QA BUILD-1: the commit shown in the footer; Vercel names it, a local build asks git, and anything else shows nothing
const commit = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
})();

const config: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: commit },
  serverExternalPackages: ["@electric-sql/pglite", "@symbolon/db"],
};

export default config;
