import "server-only";
import { getAddress, type PublicClient } from "viem";

import { getReleaseNotes } from "@symbolon/chain";

import { readCurrentImplementation } from "./release";

/**
 * How a Vault can be funded, from the implementation it actually runs (plan 01c §6, plan 05zj D, SYM-13). Release 3 added `receive()`,
 * so a plain USDC send from a wallet reaches it; releases 1 and 2 revert on one. The answer comes from the Vault's own implementation
 * slot matched against the registry's releases, never from an assumption; a Vault whose implementation can't be read or isn't a known
 * release keeps the safe warning.
 */
export interface FundingMode {
  walletSends: boolean;
  /** The release the Vault runs, when it is a known one */
  release: number | null;
}

export async function readFundingMode(client: PublicClient, vault: string): Promise<FundingMode> {
  const implementation = await readCurrentImplementation(client, getAddress(vault));
  const info = implementation ? getReleaseNotes(implementation) : undefined;
  return { walletSends: info !== undefined && info.version >= 3, release: info?.version ?? null };
}
