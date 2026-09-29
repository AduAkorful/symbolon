import type { Account, Address, Chain, Hex, PublicClient, Transport, WalletClient } from "viem";

import { simulateCall, type ContractCall } from "@symbolon/chain";

/** The Steward's own key. It can only do what the Vault lets the steward role do; it never holds funds. */
export interface StewardWallet {
  address: Address;
  /** Simulates on the node, sends, and returns the transaction hash once mined successfully */
  send(call: ContractCall): Promise<Hex>;
}

/** A viem wallet (local key) for testnet runs; production uses a Circle developer-controlled wallet */
export class ViemStewardWallet implements StewardWallet {
  constructor(
    private readonly wallet: WalletClient<Transport, Chain, Account>,
    private readonly client: PublicClient,
  ) {}

  get address(): Address {
    return this.wallet.account.address;
  }

  async send(call: ContractCall): Promise<Hex> {
    const { request } = await simulateCall(this.client, call, this.wallet.account);
    const hash = await this.wallet.writeContract(request as never);
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return hash;
  }
}
