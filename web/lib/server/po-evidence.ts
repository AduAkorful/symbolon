import "server-only";
import type { Hex } from "viem";
import { getAddress } from "viem";
import { symbolonContracts } from "@symbolon/chain";
import type { MatchViewInput } from "./match-view";

type Contracts = ReturnType<typeof symbolonContracts>;

/**
 * The purchase-order row the match evidence draws, with its open/remaining state read from the Vault. When the read
 * fails the state is "can't confirm" (open: false with no close date), never the database's own open/closed (plan 05y, Q1).
 */
export async function livePurchaseOrderEvidence(
  contracts: Contracts,
  vault: string,
  poRef: Hex,
  row: { poNumber: string; releaseAfter: Date | null; openTx: string | null; closedAt: Date | null },
): Promise<NonNullable<MatchViewInput["dbPo"]>> {
  let open = false;
  let remainingRaw: string | null = null;
  try {
    const onchain = await contracts.lens.read.getPurchaseOrder([getAddress(vault), poRef]);
    open = onchain.open;
    remainingRaw = onchain.remaining.toString();
  } catch (e) {
    console.error("purchase-order evidence: reading the PO from the Vault failed", e);
  }
  return {
    poNumber: row.poNumber,
    open,
    remainingRaw,
    releaseAfter: row.releaseAfter ?? null,
    openTx: row.openTx ?? null,
    closedAt: row.closedAt ?? null,
  };
}
