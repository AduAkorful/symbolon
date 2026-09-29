import { initiateDeveloperControlledWalletsClient, type CircleDeveloperControlledWalletsClient, type CreateWalletsInput } from "@circle-fin/developer-controlled-wallets";
import { getAddress, type Address } from "viem";

import { arcMainnet, arcTestnet } from "@symbolon/chain";

/** Circle's blockchain name for one of Arc's chains: "ARC-TESTNET" is in the installed SDK's `Blockchain` type (checked 2026-09-29) */
export type CircleBlockchain = CreateWalletsInput["blockchains"][number];

export function circleBlockchain(chainId: number): CircleBlockchain {
  if (chainId === arcTestnet.id) return "ARC-TESTNET";
  if (chainId === arcMainnet.id) return "ARC";
  throw new Error(`no Circle blockchain for chain ${chainId}`);
}

/** Circle's developer-controlled client. The entity secret comes from the caller's environment and goes nowhere else. */
export function createCircleClient(apiKey: string, entitySecret: string): CircleDeveloperControlledWalletsClient {
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

export const STEWARD_WALLET_SET = "Symbolon Stewards";

export interface ProvisionedWallet {
  walletId: string;
  address: Address;
}

/**
 * The wallet set Steward wallets live in: the one the operator named, else one created under a fixed idempotency key, so
 * Circle hands back the same set on every call. (The SDK's wallet-set type carries no name to look one up by.)
 */
async function walletSetId(circle: CircleDeveloperControlledWalletsClient, configured?: string): Promise<string> {
  if (configured) return configured;
  const made = await circle.createWalletSet({ name: STEWARD_WALLET_SET, idempotencyKey: uuidFor(`wallet-set:${STEWARD_WALLET_SET}`) });
  const id = made.data?.walletSet?.id;
  if (!id) throw new Error("Circle didn't return a wallet set id");
  return id;
}

/**
 * One Steward wallet per business (plan 05h, H10). The wallet is looked up by `refId` first, so calling this twice (a retry,
 * two tabs) never makes a second one. It is an EOA: the Vault's steward role is a plain address.
 */
export async function provisionStewardWallet(
  circle: CircleDeveloperControlledWalletsClient,
  a: { chainId: number; refId: string; walletSetId?: string },
): Promise<ProvisionedWallet> {
  const blockchain = circleBlockchain(a.chainId);
  const existing = await circle.listWallets({ blockchain, refId: a.refId, ...(a.walletSetId ? { walletSetId: a.walletSetId } : {}) });
  const live = (existing.data?.wallets ?? []).filter((w) => w.blockchain === blockchain && w.refId === a.refId && w.state !== "FROZEN");
  if (live.length > 1) throw new Error(`Circle has ${live.length} wallets for ${a.refId}; refusing to pick one`);
  if (live[0]) return { walletId: live[0].id, address: getAddress(live[0].address) };

  const setId = await walletSetId(circle, a.walletSetId);
  const made = await circle.createWallets({
    blockchains: [blockchain],
    count: 1,
    walletSetId: setId,
    accountType: "EOA",
    metadata: [{ name: "Symbolon Steward", refId: a.refId }],
    // the same business always asks with the same key, so a lost response can be retried without a second wallet
    idempotencyKey: uuidFor(`steward:${a.chainId}:${a.refId}`),
  });
  const wallet = made.data?.wallets?.[0];
  if (!wallet) throw new Error("Circle didn't return a wallet");
  return { walletId: wallet.id, address: getAddress(wallet.address) };
}

/** A UUID (v4 layout) derived from a string, for Circle's idempotency keys */
function uuidFor(seed: string): string {
  const bytes = new TextEncoder().encode(seed);
  // FNV-1a, four rounds with different offsets: only needs to be stable and well spread, not secret
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((offset) => {
    let h = offset >>> 0;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h;
  });
  const h = words.map((w) => w.toString(16).padStart(8, "0")).join("").split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
