import type { Eip1193 } from "@/components/signin/wallet";

// Plan 05h, H4. Whatever the person signs with, the rest of the wizard sees one thing: send this call, get a transaction hash.

export interface ChainParams {
  chainIdHex: string;
  name: string;
  currency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  explorerUrl: string;
}

export type SignerPlan =
  | { kind: "wallet"; address: string; chain: ChainParams }
  | { kind: "none"; reason: string };

export interface Call {
  to: string;
  data: string;
}

/** EIP-1193 code for "the person closed the request" and for "this wallet doesn't know that chain" */
const REJECTED = 4001;
const UNKNOWN_CHAIN = 4902;

const code = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: number }).code : undefined);

/** Picks, among the wallets in the browser, the one that holds the signed-in address */
export async function findWalletFor(address: string, providers: Eip1193[]): Promise<Eip1193 | null> {
  for (const p of providers) {
    try {
      const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts.some((a) => a.toLowerCase() === address.toLowerCase())) return p;
    } catch (e) {
      if (code(e) === REJECTED) throw e;
    }
  }
  return null;
}

/** Puts the wallet on Arc (switching, or adding the chain from the registry's own parameters), so a transaction can't go to the wrong network */
export async function ensureChain(p: Eip1193, chain: ChainParams): Promise<void> {
  const current = (await p.request({ method: "eth_chainId" })) as string;
  if (current.toLowerCase() === chain.chainIdHex.toLowerCase()) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
  } catch (e) {
    if (code(e) !== UNKNOWN_CHAIN) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: chain.chainIdHex, chainName: chain.name, nativeCurrency: chain.currency, rpcUrls: chain.rpcUrls, blockExplorerUrls: [chain.explorerUrl] }],
    });
  }
}

/** Sends one call from the signed-in wallet and returns the hash. Nothing is sent from any other account or network. */
export async function sendWithWallet(providers: Eip1193[], plan: Extract<SignerPlan, { kind: "wallet" }>, call: Call): Promise<string> {
  const p = await findWalletFor(plan.address, providers);
  if (!p) throw new Error(wrongWalletMessage(plan.address));
  await ensureChain(p, plan.chain);
  await requireFees(p, plan.address);
  const hash = (await p.request({ method: "eth_sendTransaction", params: [{ from: plan.address, to: call.to, data: call.data }] })) as string;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet didn't return a transaction hash.");
  return hash;
}

/** Said when this sign-in doesn't control the wallet the account was made with (plan 05k, P4) */
export const wrongWalletMessage = (address: string) =>
  `This sign-in doesn't control the wallet on your Symbolon account (${address}). Sign in the way you did when you made the account.`;

/** Arc's fee token is USDC, so a wallet with none can't send anything. Say so before a wallet window opens (plan 05k, P6). */
export class NeedsFeesError extends Error {
  constructor(readonly address: string) {
    super(`This wallet needs a little USDC on Arc to pay network fees. Send some to ${address}, then try again.`);
    this.name = "NeedsFeesError";
  }
}

async function requireFees(p: Eip1193, address: string): Promise<void> {
  const balance = (await p.request({ method: "eth_getBalance", params: [address, "latest"] })) as string;
  if (typeof balance !== "string" || !/^0x[0-9a-fA-F]+$/.test(balance)) throw new Error("Couldn't read the wallet's balance. Try again.");
  if (BigInt(balance) === 0n) throw new NeedsFeesError(address);
}

export const wasRejected = (e: unknown) => code(e) === REJECTED;

/** Sends a call with the plan's signer. `discover` finds the browser wallets (kept out of here so this file runs without a window). */
export async function sendCall(plan: SignerPlan, call: Call, discover: () => Promise<Eip1193[]>): Promise<string> {
  if (plan.kind === "none") throw new Error(plan.reason);
  return sendWithWallet(await discover(), plan, call);
}
