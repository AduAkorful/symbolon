import { erc20Abi, pad, parseAbi, type Address, type Hex } from "viem";

import type { ContractCall } from "./calls.js";

/** Circle Gateway API (plan 14). Public; no key. */
export const GATEWAY_API = { testnet: "https://gateway-api-testnet.circle.com", mainnet: "https://gateway-api.circle.com" } as const;
export type GatewayNetwork = keyof typeof GATEWAY_API;

export const gatewayWalletAbi = parseAbi(["function deposit(address token, uint256 value)"]);
export const gatewayMinterAbi = parseAbi(["function gatewayMint(bytes attestationPayload, bytes signature)"]);

export interface GatewayDomain {
  chain: string;
  network: string;
  domain: number;
  walletContract?: { address: Address; supportedTokens: string[] };
  minterContract?: { address: Address; supportedTokens: string[] };
}

/** Gateway's own list of domains and contracts; addresses are taken from here, never typed in */
export async function gatewayInfo(network: GatewayNetwork, fetcher: typeof fetch = fetch): Promise<GatewayDomain[]> {
  const res = await fetcher(`${GATEWAY_API[network]}/v1/info`);
  if (!res.ok) throw new Error(`Gateway info failed: ${res.status}`);
  return ((await res.json()) as { domains: GatewayDomain[] }).domains;
}

export function gatewayDomain(domains: readonly GatewayDomain[], domain: number): Required<Pick<GatewayDomain, "walletContract" | "minterContract">> & GatewayDomain {
  const d = domains.find((x) => x.domain === domain);
  if (!d?.walletContract || !d.minterContract) throw new Error(`Gateway has no wallet and minter on domain ${domain}`);
  return d as Required<Pick<GatewayDomain, "walletContract" | "minterContract">> & GatewayDomain;
}

/** A depositor's Gateway balance per domain, in raw USDC units */
export async function gatewayBalances(
  network: GatewayNetwork,
  depositor: Address,
  domains: readonly number[],
  fetcher: typeof fetch = fetch,
): Promise<{ domain: number; balance: bigint }[]> {
  const res = await fetcher(`${GATEWAY_API[network]}/v1/balances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: domains.map((domain) => ({ domain, depositor })) }),
  });
  if (!res.ok) throw new Error(`Gateway balances failed: ${res.status}`);
  const body = (await res.json()) as { balances: { domain: number; balance: string }[] };
  // the API reports decimal USDC strings; keep full precision as raw units
  return body.balances.map((b) => ({ domain: b.domain, balance: decimalToUnits(b.balance, 6) }));
}

function decimalToUnits(value: string, decimals: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) throw new Error(`unexpected amount "${value}"`);
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** Approve and deposit on the source chain, from the owner's wallet */
export function gatewayDepositCalls(wallet: Address, token: Address, value: bigint): [ContractCall, ContractCall] {
  return [
    { address: token, abi: erc20Abi, functionName: "approve", args: [wallet, value] },
    { address: wallet, abi: gatewayWalletAbi, functionName: "deposit", args: [token, value] },
  ];
}

const MAX_UINT256 = (1n << 256n) - 1n;
const toBytes32 = (a: Address) => pad(a.toLowerCase() as Hex, { size: 32 });

export interface BurnIntentParams {
  source: { domain: number; wallet: Address; token: Address };
  destination: { domain: number; minter: Address; token: Address };
  depositor: Address;
  /** Where the minted USDC goes: for Symbolon, the business's Vault */
  recipient: Address;
  value: bigint;
  maxFee: bigint;
  maxBlockHeight?: bigint;
  salt: Hex;
}

/** Circle's `BurnIntent` EIP-712 definition (domain has no chainId), ready for any wallet to sign */
export function burnIntentTypedData(p: BurnIntentParams) {
  return {
    domain: { name: "GatewayWallet", version: "1" },
    types: {
      TransferSpec: [
        { name: "version", type: "uint32" },
        { name: "sourceDomain", type: "uint32" },
        { name: "destinationDomain", type: "uint32" },
        { name: "sourceContract", type: "bytes32" },
        { name: "destinationContract", type: "bytes32" },
        { name: "sourceToken", type: "bytes32" },
        { name: "destinationToken", type: "bytes32" },
        { name: "sourceDepositor", type: "bytes32" },
        { name: "destinationRecipient", type: "bytes32" },
        { name: "sourceSigner", type: "bytes32" },
        { name: "destinationCaller", type: "bytes32" },
        { name: "value", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "hookData", type: "bytes" },
      ],
      BurnIntent: [
        { name: "maxBlockHeight", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "spec", type: "TransferSpec" },
      ],
    },
    primaryType: "BurnIntent",
    message: {
      maxBlockHeight: p.maxBlockHeight ?? MAX_UINT256,
      maxFee: p.maxFee,
      spec: {
        version: 1,
        sourceDomain: p.source.domain,
        destinationDomain: p.destination.domain,
        sourceContract: toBytes32(p.source.wallet),
        destinationContract: toBytes32(p.destination.minter),
        sourceToken: toBytes32(p.source.token),
        destinationToken: toBytes32(p.destination.token),
        sourceDepositor: toBytes32(p.depositor),
        destinationRecipient: toBytes32(p.recipient),
        sourceSigner: toBytes32(p.depositor),
        destinationCaller: toBytes32("0x0000000000000000000000000000000000000000"),
        value: p.value,
        salt: p.salt,
        hookData: "0x" as Hex,
      },
    },
  } as const;
}

export type BurnIntentMessage = ReturnType<typeof burnIntentTypedData>["message"];

const json = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x));

/** Submits signed burn intents; returns the attestation and Circle's signature for `gatewayMint` */
export async function submitBurnIntents(
  network: GatewayNetwork,
  intents: readonly { burnIntent: BurnIntentMessage; signature: Hex }[],
  fetcher: typeof fetch = fetch,
): Promise<{ attestation: Hex; signature: Hex }> {
  const res = await fetcher(`${GATEWAY_API[network]}/v1/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json(intents),
  });
  if (!res.ok) throw new Error(`Gateway transfer failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { attestation?: Hex; signature?: Hex };
  if (!body.attestation || !body.signature) throw new Error("Gateway returned no attestation");
  return { attestation: body.attestation, signature: body.signature };
}

/** The destination-chain mint; anyone may send it, the USDC goes only to the recipient the depositor signed */
export function gatewayMintCall(minter: Address, attestation: Hex, signature: Hex): ContractCall {
  return { address: minter, abi: gatewayMinterAbi, functionName: "gatewayMint", args: [attestation, signature] };
}

