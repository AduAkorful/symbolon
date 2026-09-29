import { getAddress, type Address } from "viem";

import { deployments } from "./generated/deployments.js";

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
    explorer: String(ext.explorer),
  };
}
