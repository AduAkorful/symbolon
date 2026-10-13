import { erc20Abi, erc4626Abi, type Address, type PublicClient } from "viem";

/** What exiting a lending venue would return right now, found by asking the node, never assumed */
export type LendingExit = { ok: true; assets: bigint } | { ok: false; reason: string };

/**
 * Simulates `venue.redeem(shares, vault, vault)` exactly as the Vault would send it: an `eth_call` from the Vault's own
 * address (nothing is sent). ERC-4626 `max*` functions are not used: Morpho Vault V2 returns 0 from them whatever the
 * liquidity, and a venue's exit can depend on its market's free liquidity and on gates its curator sets.
 */
export async function simulateLendingExit(
  client: PublicClient,
  venue: Address,
  vault: Address,
  shares: bigint,
): Promise<LendingExit> {
  if (shares === 0n) return { ok: true, assets: 0n };
  try {
    const { result } = await client.simulateContract({
      address: venue,
      abi: erc4626Abi,
      functionName: "redeem",
      args: [shares, vault, vault],
      account: vault,
    });
    return { ok: true, assets: result };
  } catch (e) {
    const reason = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
    return { ok: false, reason };
  }
}

/** The venue's own quote for `assets` of cash: shares the Vault would receive (before the Vault's own checks) */
export async function previewLendingDeposit(client: PublicClient, venue: Address, assets: bigint): Promise<bigint> {
  return client.readContract({ address: venue, abi: erc4626Abi, functionName: "previewDeposit", args: [assets] });
}

/** Assets per whole share (shares' own decimals) for share-price sampling; the venue's `convertToAssets` of one share */
export async function lendingSharePrice(client: PublicClient, venue: Address): Promise<{ assets: bigint; shareDecimals: number }> {
  const shareDecimals = await client.readContract({ address: venue, abi: erc20Abi, functionName: "decimals" });
  const assets = await client.readContract({
    address: venue,
    abi: erc4626Abi,
    functionName: "convertToAssets",
    args: [10n ** BigInt(shareDecimals)],
  });
  return { assets, shareDecimals };
}
