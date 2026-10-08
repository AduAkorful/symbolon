import { parseAbi, type Address, type Hex, type PublicClient } from "viem";

import type { SymbolonContracts } from "@symbolon/chain";
import type { Invoice } from "@symbolon/seal";
import type { Budget, VaultFacts } from "@symbolon/steward";

const ZERO32: Hex = `0x${"00".repeat(32)}`;
const CCTP_ABI = parseAbi([
  "function localMinter() view returns (address)",
  "function burnLimitsPerMessage(address token) view returns (uint256)",
]);

/**
 * Everything the Steward's policy mirror needs, read from chain through `VaultLens` at one block. Chain time comes from
 * that block, never the server clock. A caller reading several invoices at once passes the block it already fetched
 * (`at`), so the list reads one block instead of one per invoice.
 */
export async function readVaultFacts(
  contracts: SymbolonContracts,
  client: PublicClient,
  vault: Address,
  invoice: Invoice,
  fingerprint: Hex,
  at?: { number: bigint; timestamp: bigint },
): Promise<VaultFacts> {
  const lens = contracts.lens.read;
  const block = at ?? (await client.getBlock());
  const blockNumber = block.number;
  const [state, payee, po, delivered, tokenOk, localDomain, messenger] = await Promise.all([
    lens.getVaultState([vault], { blockNumber }),
    lens.getPayee([vault, invoice.seal], { blockNumber }),
    invoice.poRef === ZERO32 ? Promise.resolve(undefined) : lens.getPurchaseOrder([vault, invoice.poRef], { blockNumber }),
    lens.deliveryConfirmed([vault, fingerprint], { blockNumber }),
    lens.isSupportedToken([vault, invoice.token], { blockNumber }),
    contracts.ledger.read.localDomain({ blockNumber }),
    contracts.ledger.read.tokenMessenger({ blockNumber }),
  ]);
  // CCTP's own per-token limit, via the minter the TokenMessenger reports (0 = the token can't be burned here)
  let burnLimit = 0n;
  if (invoice.payoutDomain !== localDomain && messenger !== "0x0000000000000000000000000000000000000000") {
    const minter = await client.readContract({ address: messenger, abi: CCTP_ABI, functionName: "localMinter", blockNumber });
    burnLimit = await client.readContract({ address: minter, abi: CCTP_ABI, functionName: "burnLimitsPerMessage", args: [invoice.token], blockNumber });
  }
  const budgetIds = [...new Set([payee.terms.budget, po?.budget].filter((b): b is Hex => b !== undefined))];
  const budgets = new Map<string, Budget>(
    await Promise.all(budgetIds.map(async (id) => [id, await lens.getBudget([vault, id], { blockNumber })] as const)),
  );
  return {
    now: block.timestamp,
    paused: state.paused,
    policy: state.policy,
    isSupportedToken: (token) => token.toLowerCase() === invoice.token.toLowerCase() && tokenOk,
    payee: payee.exists ? payee : undefined,
    budget: (id) => budgets.get(id),
    purchaseOrder: po,
    deliveryConfirmed: delivered,
    localDomain,
    cctpBurnLimit: (token) => (token.toLowerCase() === invoice.token.toLowerCase() ? burnLimit : 0n),
  };
}
