import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { getConfig } from "./config";
import { devSignInAllowed } from "./dev-signin";
import { AuthError } from "./errors";

// Plan 05h, H11. A local test key standing in for a business's Steward wallet where Circle credentials aren't set, so the
// setup flow can run on Arc testnet. Same gate as the dev sign-in and the dev owner wallet: development builds on a testnet only.
// Only the address ever leaves this file. (Slice 5 will need the key to act as the Steward; it reads it from here.)

const FILE = () => resolve(process.cwd(), ".data/dev-stewards.json");

function keys(): Record<string, Hex> {
  try {
    return JSON.parse(readFileSync(FILE(), "utf8")) as Record<string, Hex>;
  } catch {
    return {};
  }
}

/** The dev Steward's address for one business, made on first use. Idempotent, like the Circle path. */
export async function devStewardAddress(businessId: string): Promise<string> {
  if (!devSignInAllowed(getConfig())) throw new AuthError(404, "Not found.");
  const all = keys();
  let key = all[businessId];
  if (!key) {
    key = generatePrivateKey();
    mkdirSync(dirname(FILE()), { recursive: true });
    writeFileSync(FILE(), JSON.stringify({ ...all, [businessId]: key }, null, 2), { mode: 0o600 });
  }
  return privateKeyToAccount(key).address;
}
