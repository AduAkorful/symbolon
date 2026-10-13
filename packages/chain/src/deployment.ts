import { getAddress, type Address } from "viem";

import { deployments } from "./generated/deployments.js";

/** An ERC-4626 lending vault the app may offer as a Vault's lending reserve (plan 05zk). Listed, never typed in. */
export interface LendingVenueInfo {
  address: Address;
  name: string;
  /** The token it holds; must be a token the Vault pays in */
  asset: Address;
  /** "test" venues are labelled as tests everywhere: they show how it works, not a return */
  kind: "test" | "production";
  source: string;
  readAt: string;
}

/** Symbolon's contracts and the external contracts they were deployed against, for one chain */
export interface Deployment {
  chainId: number;
  cctpDomain: number;
  /** Log scans start here: Arc RPCs reject log queries from block 0 */
  startBlock: bigint;
  releaseVersion: number;
  releaseOwner: Address;
  contracts: {
    invoiceLedger: Address;
    releaseRegistry: Address;
    vaultImplementation: Address;
    vaultFactory: Address;
    vaultLens: Address;
  };
  tokens: { usdc: Address; eurc: Address; usyc?: Address };
  cctp: { tokenMessengerV2: Address; messageTransmitterV2: Address };
  usycTeller?: Address;
  lendingVenues: LendingVenueInfo[];
  explorer: string;
}

type Raw = (typeof deployments)[keyof typeof deployments];

/** The deployment registry for a chain, from `contracts/deployments/<chainId>.json` (generated). Throws if absent. */
export function getDeployment(chainId: number): Deployment {
  const raw = (deployments as Record<string, Raw | undefined>)[String(chainId)];
  if (!raw) throw new Error(`no Symbolon deployment on chain ${chainId}`);
  const ext = raw.externalConfig as Record<string, unknown>;
  const optional = (key: string) => (typeof ext[key] === "string" ? getAddress(ext[key] as string) : undefined);
  const usyc = optional("usyc");
  const usycTeller = optional("usycTeller");
  const venues = Array.isArray(ext.lendingVenues) ? (ext.lendingVenues as Record<string, unknown>[]) : [];
  const lendingVenues: LendingVenueInfo[] = venues.map((v) => {
    if (v.kind !== "test" && v.kind !== "production") throw new Error(`lending venue ${String(v.address)} has no kind`);
    return {
      address: getAddress(String(v.address)),
      name: String(v.name),
      asset: getAddress(String(v.asset)),
      kind: v.kind,
      source: String(v.source),
      readAt: String(v.readAt),
    };
  });
  return {
    chainId: raw.chainId,
    cctpDomain: raw.cctpDomain,
    startBlock: BigInt(raw.startBlock),
    releaseVersion: raw.release.version,
    releaseOwner: getAddress(raw.release.owner),
    contracts: {
      invoiceLedger: getAddress(raw.contracts.InvoiceLedger),
      releaseRegistry: getAddress(raw.contracts.ReleaseRegistry),
      vaultImplementation: getAddress(raw.contracts.SymbolonVaultImplementation),
      vaultFactory: getAddress(raw.contracts.VaultFactory),
      vaultLens: getAddress(raw.contracts.VaultLens),
    },
    tokens: { usdc: getAddress(raw.external.usdc), eurc: getAddress(raw.external.eurc), ...(usyc ? { usyc } : {}) },
    cctp: {
      tokenMessengerV2: getAddress(raw.external.tokenMessengerV2),
      messageTransmitterV2: getAddress(raw.external.messageTransmitterV2),
    },
    ...(usycTeller ? { usycTeller } : {}),
    lendingVenues,
    explorer: String(ext.explorer),
  };
}
