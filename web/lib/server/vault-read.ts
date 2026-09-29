import { erc20Abi, getAddress, type PublicClient } from "viem";
import { symbolonContracts, type Deployment } from "@symbolon/chain";

export type VaultSummary =
  | { ok: true; usdc: bigint; decimals: number; block: bigint }
  | { ok: false; reason: string };

/** The Vault's USDC balance at one block. A failed read is a failed read the screen names; it is never shown as zero. */
export async function readVaultSummary(client: PublicClient, deployment: Deployment, vault: string): Promise<VaultSummary> {
  try {
    const token = deployment.tokens.usdc;
    const blockNumber = await client.getBlockNumber();
    const [usdc, decimals] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(vault)], blockNumber }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals", blockNumber }),
    ]);
    return { ok: true, usdc, decimals, block: blockNumber };
  } catch {
    return { ok: false, reason: "Can't confirm the balance right now." };
  }
}

export type VaultState =
  | { ok: true; paused: boolean; steward: string; owner: string; block: bigint }
  | { ok: false; reason: string };

const ZERO = "0x0000000000000000000000000000000000000000";

/** Whether the Vault is paused and who its Steward is, from the lens at one block. A failed read is a failed read, never "active". */
export async function readVaultState(client: PublicClient, deployment: Deployment, vault: string): Promise<VaultState> {
  try {
    const blockNumber = await client.getBlockNumber();
    const state = await symbolonContracts(client, deployment).lens.read.getVaultState([getAddress(vault)], { blockNumber });
    return { ok: true, paused: state.paused, steward: state.steward, owner: state.owner, block: blockNumber };
  } catch {
    return { ok: false, reason: "Can't confirm the Steward's state right now." };
  }
}

/** What the screens say about the Steward, decided from the chain's state and the Steward wallet we recorded (plan 05h, H13–H15) */
export type StewardStanding =
  | { kind: "none" } // a Vault made before Stewards existed at creation: no Steward assigned
  | { kind: "unknown"; reason: string }
  | { kind: "mismatch"; onchain: string } // the chain's Steward isn't the wallet we recorded: shown as a problem, never as paused/active
  | { kind: "paused" | "active"; steward: string; block: bigint };

export function stewardStanding(recorded: string | null, state: VaultState): StewardStanding {
  if (!recorded) return { kind: "none" };
  if (!state.ok) return { kind: "unknown", reason: state.reason };
  if (state.steward === ZERO || getAddress(state.steward) !== getAddress(recorded)) return { kind: "mismatch", onchain: state.steward };
  return { kind: state.paused ? "paused" : "active", steward: getAddress(state.steward), block: state.block };
}
