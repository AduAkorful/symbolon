import "server-only";

import { decodeFunctionData, parseEventLogs, getAddress, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { and, eq, sql } from "drizzle-orm";
import { symbolonVaultAbi, symbolonContracts, type Deployment } from "@symbolon/chain";
import { budgets, businesses, type Database } from "@symbolon/db";
import { AuthError } from "./errors";
import { requireMember } from "./access";
import { prepareChange, recordChange, listQueuedChanges } from "./queued-change";
import { usd } from "./policy-text";

export const OPERATING_BUDGET: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const ALLOWED_PERIOD_LENGTHS = [
  7n * 86_400n, // 7 days (604,800s)
  30n * 86_400n, // 30 days (2,592,000s)
  90n * 86_400n, // 90 days (7,776,000s)
] as const;

export function deriveBudgetId(businessId: string, name: string): Hex {
  const normalized = name.normalize("NFC").trim().toLowerCase();
  if (!normalized) {
    throw new AuthError(400, "Budget name cannot be empty");
  }
  return keccak256(toHex(`symbolon.budget.v1:${businessId}:${normalized}`));
}

export interface BudgetViewItem {
  id: Hex;
  name: string;
  isOperating: boolean;
  cap: string;
  spent: string;
  remaining: string;
  periodLengthSeconds: number;
  periodLengthLabel: string;
  periodIndex: number;
  existsOnchain: boolean;
  pendingChange?: {
    changeId: Hex;
    eta: Date;
    ready: boolean;
    summary: Record<string, unknown>;
  };
}

function periodLabel(seconds: bigint): string {
  const days = Number(seconds / 86_400n);
  return `${days}-day period`;
}

export async function listBudgets(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string },
  businessId: string,
): Promise<{
  vault: Address;
  accountingDecimals: number;
  budgets: BudgetViewItem[];
}> {
  await requireMember(db, user.id, businessId);

  const [biz] = await db
    .select({
      vault: businesses.vault,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId));

  if (!biz?.vault) {
    throw new AuthError(400, "Business has no vault configured");
  }
  const vault = biz.vault as Address;

  const contracts = symbolonContracts(client, deployment);
  const accountingDecimals = await contracts.lens.read.accountingDecimals([vault]).catch(() => { throw new AuthError(502, "Can't confirm the Vault's accounting decimals."); });
  if (!Number.isInteger(accountingDecimals) || accountingDecimals < 0 || accountingDecimals > 77) throw new AuthError(502, "Can't confirm the Vault's accounting decimals.");


  // Read decimals and block timestamp
  let blockTimestamp = BigInt(Math.floor(Date.now() / 1000));
  try {
    const block = await client.getBlock({ blockTag: "latest" });
    if (block?.timestamp) {
      blockTimestamp = block.timestamp;
    }
  } catch {
    // fallback to wall clock
  }

  // Load custom budgets from DB
  const dbBudgets = await db
    .select()
    .from(budgets)
    .where(eq(budgets.businessId, businessId));

  // Also read queued changes for set_budget
  const queuedChanges = await listQueuedChanges(db, businessId, user);
  const budgetQueuedMap = new Map<Hex, (typeof queuedChanges)[number]>();
  for (const q of queuedChanges) {
    if (q.kind === "set_budget") {
      const bId = (q.summary?.details as any)?.budgetId?.toLowerCase() as Hex;
      if (bId) {
        budgetQueuedMap.set(bId, q);
      }
    }
  }

  // 1. Operating Budget
  const operatingOnchain = await contracts.lens.read.getBudget([vault, OPERATING_BUDGET]);
  const opPeriodLength = operatingOnchain.periodLength > 0n ? operatingOnchain.periodLength : 30n * 86_400n;
  const opCurrentIndex = opPeriodLength > 0n ? blockTimestamp / opPeriodLength : 0n;
  const opSpent = operatingOnchain.periodIndex === opCurrentIndex ? operatingOnchain.spent : 0n;
  const opCap = operatingOnchain.cap;
  const opRemaining = opCap > opSpent ? opCap - opSpent : 0n;

  const pendingOp = budgetQueuedMap.get(OPERATING_BUDGET.toLowerCase() as Hex);
  const items: BudgetViewItem[] = [
    {
      id: OPERATING_BUDGET,
      name: "Operating",
      isOperating: true,
      cap: opCap === 2n ** 256n - 1n ? "Unlimited" : usd(opCap),
      spent: usd(opSpent),
      remaining: opCap === 2n ** 256n - 1n ? "Unlimited" : usd(opRemaining),
      periodLengthSeconds: Number(opPeriodLength),
      periodLengthLabel: periodLabel(opPeriodLength),
      periodIndex: Number(operatingOnchain.periodIndex),
      existsOnchain: operatingOnchain.exists,
      pendingChange: pendingOp
        ? {
            changeId: pendingOp.changeId as Hex,
            eta: pendingOp.eta,
            ready: pendingOp.eta.getTime() <= Date.now() && pendingOp.status === "queued",
            summary: pendingOp.summary,
          }
        : undefined,
    },
  ];

  // 2. Custom budgets
  for (const b of dbBudgets) {
    const bId = b.budgetId.toLowerCase() as Hex;
    const onchain = await contracts.lens.read.getBudget([vault, b.budgetId as Hex]);
    const periodLen = onchain.periodLength > 0n ? onchain.periodLength : 30n * 86_400n;
    const currentIndex = periodLen > 0n ? blockTimestamp / periodLen : 0n;
    const spent = onchain.periodIndex === currentIndex ? onchain.spent : 0n;
    const cap = onchain.cap;
    const remaining = cap > spent ? cap - spent : 0n;

    const pendingCustom = budgetQueuedMap.get(bId);
    items.push({
      id: b.budgetId as Hex,
      name: b.name,
      isOperating: false,
      cap: usd(cap),
      spent: usd(spent),
      remaining: usd(remaining),
      periodLengthSeconds: Number(periodLen),
      periodLengthLabel: periodLabel(periodLen),
      periodIndex: Number(onchain.periodIndex),
      existsOnchain: onchain.exists,
      pendingChange: pendingCustom
        ? {
            changeId: pendingCustom.changeId as Hex,
            eta: pendingCustom.eta,
            ready: pendingCustom.eta.getTime() <= Date.now() && pendingCustom.status === "queued",
            summary: pendingCustom.summary,
          }
        : undefined,
    });
  }


  return {
    vault,
    accountingDecimals,
    budgets: items,
  };
}

export async function prepareCreateBudget(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  params: {
    name: string;
    cap: bigint;
    periodLength: bigint;
  },
) {
  await requireMember(db, user.id, businessId, "owner");

  const trimmedName = params.name.normalize("NFC").trim();
  if (trimmedName.length < 1 || trimmedName.length > 60 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(trimmedName)) {
    throw new AuthError(400, "Budget name must be between 1 and 60 characters");
  }

  const allowed = ALLOWED_PERIOD_LENGTHS.some((p) => p === params.periodLength);
  if (!allowed) {
    throw new AuthError(
      400,
      `Period length must be 7 days (604800s), 30 days (2592000s), or 90 days (7776000s)`,
    );
  }

  if (params.cap <= 0n) {
    throw new AuthError(400, "Budget cap must be greater than zero");
  }

  const budgetId = deriveBudgetId(businessId, trimmedName);

  // Check if budget name already exists in DB
  const [existing] = await db
    .select({ budgetId: budgets.budgetId })
    .from(budgets)
    .where(
      and(
        eq(budgets.businessId, businessId),
        sql`lower(${budgets.name}) = lower(${trimmedName})`,
      ),
    );

  if (existing) {
    throw new AuthError(409, `Budget with name "${trimmedName}" already exists`);
  }

  return prepareChange(db, client, deployment, user, businessId, {
    kind: "set_budget",
    args: [budgetId, params.cap, params.periodLength],
  });
}

export async function recordCreateBudget(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  params: {
    txHash: Hex;
    name: string;
  },
) {
  await requireMember(db, user.id, businessId, "owner");

  const name = params.name.normalize("NFC").trim();
  if (!name || name.length > 60 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(name)) throw new AuthError(400, "Invalid budget name.");
  const budgetId = deriveBudgetId(businessId, name);
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business?.vault) throw new AuthError(409, "Business has no Vault.");
  const vault = getAddress(business.vault);
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash: params.txHash }), client.getTransaction({ hash: params.txHash }),
  ]).catch(() => { throw new AuthError(409, "Can't confirm the budget transaction."); });
  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) throw new AuthError(409, "Not a successful transaction to this Vault.");
  const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: transaction.input });
  if (decoded.functionName !== "setBudget" || decoded.args[0].toLowerCase() !== budgetId) throw new AuthError(409, "The signed budget does not match this name.");
  const events = parseEventLogs({ abi: symbolonVaultAbi, eventName: "BudgetSet", logs: receipt.logs }).filter((e) => getAddress(e.address) === vault);
  if (events.length !== 1 || events[0]!.args.budget !== budgetId || events[0]!.args.cap !== decoded.args[1] || events[0]!.args.periodLength !== decoded.args[2]) throw new AuthError(409, "The matching budget was not applied.");
  const current = await symbolonContracts(client, deployment).lens.read.getBudget([vault, budgetId]);
  if (!current.exists || current.cap !== decoded.args[1] || current.periodLength !== decoded.args[2]) throw new AuthError(409, "Can't confirm the matching budget state.");
  const result = await recordChange(db, client, deployment, user, businessId, params.txHash);
  if (result.status === "applied") {
    await db
      .insert(budgets)
      .values({
        businessId,
        budgetId,
        name,
        createdBy: user.id,
      })
      .onConflictDoNothing();
  }

  return {
    ...result,
    budgetId,
  };
}

export async function prepareEditBudget(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  params: {
    budgetId: Hex;
    cap: bigint;
    periodLength: bigint;
  },
) {
  await requireMember(db, user.id, businessId, "owner");

  const allowed = ALLOWED_PERIOD_LENGTHS.some((p) => p === params.periodLength);
  if (!allowed) {
    throw new AuthError(
      400,
      `Period length must be 7 days (604800s), 30 days (2592000s), or 90 days (7776000s)`,
    );
  }

  if (params.cap <= 0n) {
    throw new AuthError(400, "Budget cap must be greater than zero");
  }

  return prepareChange(db, client, deployment, user, businessId, {
    kind: "set_budget",
    args: [params.budgetId, params.cap, params.periodLength],
  });
}

export async function recordEditBudget(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  txHash: Hex,
) {
  await requireMember(db, user.id, businessId, "owner");
  return recordChange(db, client, deployment, user, businessId, txHash);
}
