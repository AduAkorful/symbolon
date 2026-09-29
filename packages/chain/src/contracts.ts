import { getContract, parseAbi, type Address, type GetContractReturnType, type PublicClient } from "viem";

import type { Deployment } from "./deployment.js";
import {
  erc20Abi,
  invoiceLedgerAbi,
  releaseRegistryAbi,
  symbolonVaultAbi,
  usycEntitlementsAbi,
  usycTellerAbi,
  vaultFactoryAbi,
  vaultLensAbi,
} from "./generated/abis.js";

/**
 * The Teller's preview functions, which the Vault never calls but the Steward uses to size reserve moves. Signatures
 * copied from the verified Teller implementation on Arc testnet (0x238dc235e6996e93ed7fbe89e69113bfcfe1adf6).
 */
export const usycTellerPreviewAbi = parseAbi([
  "function previewDepositData(address account, uint256 assets) view returns (uint256 shares, uint256 fee, int256 price)",
  "function previewRedeemData(address account, uint256 shares) view returns (uint256 assets, uint256 fee, int256 price)",
  "function subscriptionLimitRemaining(address account, uint256 date) view returns (uint256)",
  "function redemptionLimitRemaining(address account, uint256 date) view returns (uint256)",
  "function todayTimestamp() view returns (uint256)",
]);

export const ledgerContract = (client: PublicClient, d: Deployment): GetContractReturnType<typeof invoiceLedgerAbi, PublicClient> =>
  getContract({ address: d.contracts.invoiceLedger, abi: invoiceLedgerAbi, client });
export const lensContract = (client: PublicClient, d: Deployment): GetContractReturnType<typeof vaultLensAbi, PublicClient> =>
  getContract({ address: d.contracts.vaultLens, abi: vaultLensAbi, client });
export const factoryContract = (client: PublicClient, d: Deployment): GetContractReturnType<typeof vaultFactoryAbi, PublicClient> =>
  getContract({ address: d.contracts.vaultFactory, abi: vaultFactoryAbi, client });
export const registryContract = (client: PublicClient, d: Deployment): GetContractReturnType<typeof releaseRegistryAbi, PublicClient> =>
  getContract({ address: d.contracts.releaseRegistry, abi: releaseRegistryAbi, client });
export const vaultContract = (client: PublicClient, address: Address): GetContractReturnType<typeof symbolonVaultAbi, PublicClient> =>
  getContract({ address, abi: symbolonVaultAbi, client });
export const tokenContract = (client: PublicClient, address: Address): GetContractReturnType<typeof erc20Abi, PublicClient> =>
  getContract({ address, abi: erc20Abi, client });
const tellerAbi = [...usycTellerAbi, ...usycTellerPreviewAbi] as const;
export const tellerContract = (client: PublicClient, address: Address): GetContractReturnType<typeof tellerAbi, PublicClient> =>
  getContract({ address, abi: tellerAbi, client });
export const entitlementsContract = (client: PublicClient, address: Address): GetContractReturnType<typeof usycEntitlementsAbi, PublicClient> =>
  getContract({ address, abi: usycEntitlementsAbi, client });

/** Typed read handles for every Symbolon contract on one chain */
export interface SymbolonContracts {
  ledger: ReturnType<typeof ledgerContract>;
  lens: ReturnType<typeof lensContract>;
  factory: ReturnType<typeof factoryContract>;
  registry: ReturnType<typeof registryContract>;
  vault: (address: Address) => ReturnType<typeof vaultContract>;
  token: (address: Address) => ReturnType<typeof tokenContract>;
  teller: ReturnType<typeof tellerContract> | undefined;
  entitlements: (address: Address) => ReturnType<typeof entitlementsContract>;
}

export function symbolonContracts(client: PublicClient, deployment: Deployment): SymbolonContracts {
  return {
    ledger: ledgerContract(client, deployment),
    lens: lensContract(client, deployment),
    factory: factoryContract(client, deployment),
    registry: registryContract(client, deployment),
    vault: (address) => vaultContract(client, address),
    token: (address) => tokenContract(client, address),
    teller: deployment.usycTeller ? tellerContract(client, deployment.usycTeller) : undefined,
    entitlements: (address) => entitlementsContract(client, address),
  };
}
