import type { Deployment } from "@symbolon/chain";
import type { Address, Hex } from "viem";

/** The three node calls the check needs, so tests can stand in for a real client */
export interface StatusClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getCode(args: { address: Address }): Promise<Hex | undefined>;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  address?: Address;
}

export interface ChainStatus {
  ok: boolean;
  /** Head block at the read; absent when the node couldn't be reached */
  block?: bigint;
  readAt: Date;
  checks: Check[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Confirms the node is on the chain the registry was deployed to and that every registry address has code.
 * Never throws: a failed read is a failed check, so the screen can say "can't confirm" instead of showing a guess.
 */
export async function readChainStatus(client: StatusClient, d: Deployment, now: Date = new Date()): Promise<ChainStatus> {
  const checks: Check[] = [];

  let reported: number;
  try {
    reported = await client.getChainId();
  } catch (e) {
    return { ok: false, readAt: now, checks: [{ name: "Chain", ok: false, detail: `node unreachable: ${message(e)}` }] };
  }
  if (reported !== d.chainId) {
    // A node on another chain says nothing true about these addresses, so don't read them
    return { ok: false, readAt: now, checks: [{ name: "Chain", ok: false, detail: `expected ${d.chainId}, got ${reported}` }] };
  }
  checks.push({ name: "Chain", ok: true, detail: `${d.chainId}` });

  let block: bigint | undefined;
  try {
    block = await client.getBlockNumber();
    const ahead = block >= d.startBlock;
    checks.push({ name: "Head", ok: ahead, detail: ahead ? `block ${block}` : `node is at block ${block}, behind the deployment at ${d.startBlock}` });
  } catch (e) {
    checks.push({ name: "Head", ok: false, detail: `couldn't read the head: ${message(e)}` });
  }

  const targets: [string, Address][] = [
    ["Invoice ledger", d.contracts.invoiceLedger],
    ["Release registry", d.contracts.releaseRegistry],
    ["Vault implementation", d.contracts.vaultImplementation],
    ["Vault factory", d.contracts.vaultFactory],
    ["Vault lens", d.contracts.vaultLens],
    ["USDC", d.tokens.usdc],
    ["EURC", d.tokens.eurc],
  ];
  for (const [name, address] of targets) {
    try {
      const code = await client.getCode({ address });
      const has = code !== undefined && code !== "0x";
      checks.push({ name, address, ok: has, detail: has ? "has code" : "no code at this address" });
    } catch (e) {
      checks.push({ name, address, ok: false, detail: `couldn't read: ${message(e)}` });
    }
  }

  return { ok: checks.every((c) => c.ok), ...(block !== undefined ? { block } : {}), readAt: now, checks };
}
