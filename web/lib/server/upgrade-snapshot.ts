import "server-only";
import { eq } from "drizzle-orm";
import { getAddress, zeroHash, type Address, type PublicClient } from "viem";
import { symbolonContracts, type Deployment } from "@symbolon/chain";
import { budgets, deliveries, members, payees, purchaseOrders, users, type Database } from "@symbolon/db";
import { canonicalJson } from "@symbolon/seal";

export interface UpgradeScope {
  payees: string[];
  budgets: string[];
  wallets: string[];
  purchaseOrders: string[];
  deliveries: string[];
}
export interface UpgradeSnapshot {
  block: string;
  scope: UpgradeScope;
  state: Record<string, unknown>;
}

/** Capture the known records, keeping the exact same keys for the post-upgrade comparison. */
export async function upgradeScope(db: Database, businessId: string): Promise<UpgradeScope> {
  const [p, b, m, po, d] = await Promise.all([
    db.select().from(payees).where(eq(payees.businessId, businessId)),
    db.select().from(budgets).where(eq(budgets.businessId, businessId)),
    db.select({ wallet: users.wallet }).from(members).innerJoin(users, eq(users.id, members.userId)).where(eq(members.businessId, businessId)),
    db.select().from(purchaseOrders).where(eq(purchaseOrders.businessId, businessId)),
    db.select().from(deliveries).where(eq(deliveries.businessId, businessId)),
  ]);
  const sorted = (values: string[]) => [...new Set(values.map(v => v.toLowerCase()))].sort();
  return { payees: sorted(p.map(r => r.seal)), budgets: sorted([zeroHash, ...b.map(r => r.budgetId)]),
    wallets: sorted(m.flatMap(r => r.wallet ? [r.wallet] : [])), purchaseOrders: sorted(po.map(r => r.poRef)), deliveries: sorted(d.map(r => r.fingerprint)) };
}

export async function captureUpgradeSnapshot(client: PublicClient, deployment: Deployment, vault: Address, scope: UpgradeScope, block: bigint): Promise<UpgradeSnapshot> {
  const contracts = symbolonContracts(client, deployment);
  const opts = { blockNumber: block };
  const [vaultState, reservePolicy, balances, payeeState, budgetState, roles, orders, deliveryState] = await Promise.all([
    contracts.lens.read.getVaultState([vault], opts),
    contracts.lens.read.getReservePolicy([vault], opts),
    Promise.all(Object.entries(deployment.tokens).map(async ([symbol, token]) => [symbol, { balance: await contracts.token(token).read.balanceOf([vault], opts), supported: await contracts.lens.read.isSupportedToken([vault, token], opts) }])),
    Promise.all(scope.payees.map(async seal => [seal, await contracts.lens.read.getPayee([vault, getAddress(seal)], opts)])),
    Promise.all(scope.budgets.map(async id => [id, await contracts.lens.read.getBudget([vault, id as `0x${string}`], opts)])),
    Promise.all(scope.wallets.map(async wallet => [wallet, { requester: await contracts.lens.read.isRequester([vault, getAddress(wallet)], opts), count: await contracts.lens.read.approverBudgetCount([vault, getAddress(wallet)], opts), approvals: await Promise.all(scope.budgets.map(async id => [id, await contracts.lens.read.isApprover([vault, getAddress(wallet), id as `0x${string}`], opts)])) }])),
    Promise.all(scope.purchaseOrders.map(async id => [id, await contracts.lens.read.getPurchaseOrder([vault, id as `0x${string}`], opts)])),
    Promise.all(scope.deliveries.map(async fp => [fp, await contracts.lens.read.deliveryConfirmed([vault, fp as `0x${string}`], opts)])),
  ]);
  // Mandatory unavailable reads must fail preparation/verification, never turn into an empty match.
  const state = { vaultState, reservePolicy, balances, payees: payeeState, budgets: budgetState, roles, purchaseOrders: orders, deliveries: deliveryState };
  return { block: block.toString(), scope, state: JSON.parse(JSON.stringify(state, (_, value: unknown) => {
    if (value === null || value === undefined) throw new Error("Upgrade state read unavailable.");
    return typeof value === "bigint" ? value.toString() : value;
  })) as Record<string, unknown> };
}

export function compareUpgradeSnapshots(before: UpgradeSnapshot, after: UpgradeSnapshot): { match: boolean; diffs: string[] } {
  const diffs = Object.keys(before.state).filter(key => canonicalJson(before.state[key]) !== canonicalJson(after.state[key]));
  return { match: diffs.length === 0, diffs };
}
