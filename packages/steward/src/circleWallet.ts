import type { CircleDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { keccak256, type Address, type Hex, type PublicClient } from "viem";

import { simulateCall, toTransaction, type ContractCall } from "@symbolon/chain";

import type { StewardWallet } from "./wallet.js";

/**
 * A UUID (v4 layout) derived from the calldata, used as Circle's idempotency key: the same call (which embeds the
 * decision hash) can never be submitted twice by a retry.
 */
export function idempotencyKeyFor(data: Hex): string {
  const h = keccak256(data).slice(2, 34).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * The Steward's key as a Circle developer-controlled wallet (plan 00 §3: the key never touches the model or our
 * server). Simulates on the node first, submits through Circle, waits for the transaction, then confirms the receipt
 * on chain rather than trusting the SDK's status.
 */
export class CircleStewardWallet implements StewardWallet {
  constructor(
    private readonly circle: CircleDeveloperControlledWalletsClient,
    private readonly walletId: string,
    readonly address: Address,
    private readonly client: PublicClient,
  ) {}

  async send(call: ContractCall): Promise<Hex> {
    await simulateCall(this.client, call, this.address);
    const { data } = toTransaction(call);
    const created = await this.circle.createContractExecutionTransaction({
      walletId: this.walletId,
      contractAddress: call.address,
      callData: data,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: idempotencyKeyFor(data),
    });
    const id = created.data?.id;
    if (!id) throw new Error("Circle didn't return a transaction id");

    const tx = await this.circle.getTransaction({ id, waitForTxHash: true });
    const hash = tx.data.transaction.txHash as Hex;
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return hash;
  }
}
