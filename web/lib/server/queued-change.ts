import "server-only";

import {
  symbolonContracts,
  symbolonVaultAbi,
  vaultCall,
  toTransaction,
  type Deployment,
} from "@symbolon/chain";
import {
  businesses,
  chainEvents,
  decisions,
  queuedChanges,
  type Database,
} from "@symbolon/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import {
  CHANGE_KINDS,
  GATED_FUNCTION_NAMES,
  getChangeKindByFunctionName,
  getChangeKindByKindName,
  type ChangeKindDef,
  type GatedFunctionName,
} from "./change-kinds";
import { AuthError } from "./errors";
import {
  isLooseningAddressRole,
  isLooseningAutoUpdate,
  isLooseningBudget,
  isLooseningPolicy,
  isLooseningReservePolicy,
  isLooseningRole,
  isLooseningSupportedToken,
  isLooseningTerms,
  type BudgetShape,
  type PayeeTermsShape,
  type PolicyShape,
  type ReservePolicyShape,
} from "./loosening";

export interface QueuedChangeSpec {
  kind: string; // function name or kind name
  args: readonly unknown[];
}

export type QueuedChangeState = "apply-now" | "will-queue" | "already-queued" | "ready";

export interface PreparedChangeResult {
  ok: true;
  state: QueuedChangeState;
  changeId: Hex;
  to: Address;
  data: Hex;
  chainId: number;
  summary: { title: string; details?: Record<string, unknown> };
  eta?: Date;
  loosening: boolean;
}

/**
 * Prepares a call that is gated by SymbolonVault._gate(loosening).
 * Determines whether it applies immediately or must be queued, and computes its changeId.
 */
export async function prepareChange(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  spec: QueuedChangeSpec,
): Promise<PreparedChangeResult> {
  await requireMember(db, user.id, businessId, "owner");
  if (!user.wallet) throw new AuthError(403, "No wallet registered for this user.");

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business || !business.vault) {
    throw new AuthError(404, "Business Vault not found.");
  }

  const vault = getAddress(business.vault);
  const contracts = symbolonContracts(client, deployment);

  const vaultState = await contracts.lens.read.getVaultState([vault]).catch(() => {
    throw new AuthError(502, "Could not read Vault state from chain.");
  });

  if (getAddress(vaultState.owner) !== getAddress(user.wallet)) {
    throw new AuthError(403, "Your wallet is not the owner of this Vault.");
  }

  const kindDef =
    getChangeKindByFunctionName(spec.kind) ?? getChangeKindByKindName(spec.kind);
  if (!kindDef) {
    throw new AuthError(400, `Unknown change kind or function: ${spec.kind}`);
  }

  const call = vaultCall(
    vault,
    kindDef.functionName as any,
    spec.args as any,
  );
  const { data } = toTransaction(call);
  const changeId = keccak256(data);
  const summary = kindDef.describe(spec.args);

  // Evaluate loosening mirror
  const loosening = await evaluateLoosening(
    contracts,
    vault,
    vaultState,
    kindDef.functionName as GatedFunctionName,
    spec.args,
  );

  const looseningDelay = vaultState.policy.looseningDelay;
  const etaOnchainSec = await contracts.lens.read
    .queuedChangeEta([vault, changeId])
    .catch(() => { throw new AuthError(502, "Can't confirm the queued change ETA."); });

  const block = await client.getBlock({ blockTag: "latest" }).catch(() => { throw new AuthError(502, "Can't read chain time."); });
  const nowSec = block.timestamp;

  let state: QueuedChangeState;
  let etaDate: Date | undefined;

  if (!loosening || looseningDelay === 0n) {
    state = "apply-now";
  } else if (etaOnchainSec === 0n) {
    state = "will-queue";
    etaDate = new Date(Number(nowSec + looseningDelay) * 1000);
  } else if (etaOnchainSec > nowSec) {
    state = "already-queued";
    etaDate = new Date(Number(etaOnchainSec) * 1000);
  } else {
    state = "ready";
    etaDate = new Date(Number(etaOnchainSec) * 1000);
  }

  return {
    ok: true,
    state,
    changeId,
    to: vault,
    data,
    chainId: business.chainId,
    summary,
    eta: etaDate,
    loosening,
  };
}

/**
 * Checks whether a specific call is loosening by reading current state from lens.
 */
async function evaluateLoosening(
  contracts: ReturnType<typeof symbolonContracts>,
  vault: Address,
  vaultState: Awaited<ReturnType<typeof contracts.lens.read.getVaultState>>,
  fnName: GatedFunctionName,
  args: readonly unknown[],
): Promise<boolean> {
  switch (fnName) {
    case "setPolicy": {
      const next = args[0] as PolicyShape;
      return isLooseningPolicy(vaultState.policy as PolicyShape, next);
    }
    case "setBudget": {
      const budgetId = args[0] as Hex;
      const next = { cap: BigInt(args[1] as bigint), periodLength: BigInt(args[2] as bigint) };
      const current = await contracts.lens.read.getBudget([vault, budgetId]) .catch(() => { throw new AuthError(502, "Can't read the current budget."); });
      return isLooseningBudget(current as BudgetShape, next);
    }
    case "updatePayeeTerms": {
      const seal = getAddress(args[0] as Address);
      const next = args[1] as PayeeTermsShape;
      const payee = await contracts.lens.read.getPayee([vault, seal]).catch(() => { throw new AuthError(502, "Can't read current payee terms."); });
      return isLooseningTerms(payee.terms as PayeeTermsShape, next);
    }
    case "setApprover": {
      const enabled = Boolean(args[2]);
      return isLooseningRole("approver", enabled);
    }
    case "setRequester": {
      const enabled = Boolean(args[1]);
      return isLooseningRole("requester", enabled);
    }
    case "setScreener": {
      const screener = args[0] as Address;
      return isLooseningAddressRole("screener", screener);
    }
    case "setSteward": {
      const steward = args[0] as Address;
      return isLooseningAddressRole("steward", steward);
    }
    case "setSupportedToken": {
      const supported = Boolean(args[1]);
      return isLooseningSupportedToken(supported);
    }
    case "setAutoUpdate": {
      const enabled = Boolean(args[0]);
      return isLooseningAutoUpdate(enabled);
    }
    case "setReservePolicy": {
      const next = args[0] as ReservePolicyShape;
      const reserve = await contracts.lens.read.reserveStatus([vault]).catch(() => { throw new AuthError(502, "Can't read the reserve policy."); });
      return isLooseningReservePolicy(reserve.policy as ReservePolicyShape, next);
    }
  }
}

/**
 * Records the confirmation of an owner-signed transaction:
 * - ChangeQueued -> inserts row in queued_changes with calldata from tx input
 * - ChangeCancelled -> updates row to cancelled
 * - Applied event -> updates row to applied, or inserts applied row for immediate changes
 */
export async function recordChange(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  txHash: Hex,
) {
  await requireMember(db, user.id, businessId, "owner");
  if (!user.wallet) throw new AuthError(403, "No wallet registered for this user.");

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business || !business.vault) {
    throw new AuthError(404, "Business Vault not found.");
  }

  const vault = getAddress(business.vault);

  // Check idempotency: already recorded?
  const [existingRecord] = await db
    .select()
    .from(queuedChanges)
    .where(
      and(
        eq(queuedChanges.businessId, businessId),
        inArray(queuedChanges.queueTx, [txHash]),
      ),
    )
    .limit(1);

  if (existingRecord) {
    return { ok: true, status: existingRecord.status, changeId: existingRecord.changeId };
  }

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    throw new AuthError(409, "Transaction not confirmed yet. Try again shortly.");
  }

  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) {
    throw new AuthError(409, "Transaction failed or was not sent to this Vault.");
  }

  // Parse receipt logs
  const queuedEvents = parseEventLogs({
    abi: symbolonVaultAbi,
    eventName: "ChangeQueued",
    logs: receipt.logs,
  }).filter((l) => getAddress(l.address) === vault);

  const cancelledEvents = parseEventLogs({
    abi: symbolonVaultAbi,
    eventName: "ChangeCancelled",
    logs: receipt.logs,
  }).filter((l) => getAddress(l.address) === vault);

  // Check for ChangeQueued
  if (queuedEvents.length === 1) {
    const ev = queuedEvents[0]!;
    const id = (ev.args.changeId ?? (ev.args as any).id).toLowerCase() as Hex;
    const selector = ev.args.selector.toLowerCase();
    const etaSec = Number(ev.args.eta);

    const tx = await client.getTransaction({ hash: txHash }).catch(() => null);
    if (!tx || !tx.input) {
      throw new AuthError(502, "Could not fetch transaction calldata.");
    }

    if (keccak256(tx.input).toLowerCase() !== id) {
      throw new AuthError(409, "Transaction input does not match ChangeQueued id.");
    }

    let kind = "unknown";
    let summary: Record<string, unknown> = { title: "Queued change" };
    try {
      const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: tx.input });
      const kindDef = getChangeKindByFunctionName(decoded.functionName);
      if (kindDef) {
        kind = kindDef.kind;
        summary = kindDef.describe(decoded.args as readonly unknown[]);
      }
    } catch {
      // generic fallback
    }

    const [row] = await db
      .insert(queuedChanges)
      .values({
        businessId,
        kind,
        changeId: id,
        selector,
        calldata: tx.input,
        summary,
        createdBy: user.id,
        eta: new Date(etaSec * 1000),
        status: "queued",
        queueTx: txHash,
      })
      .onConflictDoUpdate({
        target: [queuedChanges.businessId, queuedChanges.changeId],
        set: {
          status: "queued",
          queueTx: txHash,
          calldata: tx.input,
          eta: new Date(etaSec * 1000),
          updatedAt: new Date(),
        },
      })
      .returning();

    await appendAppDecision(
      db,
      businessId,
      {
        kind: "change_queued",
        subject: id,
        actor: user.id,
        inputs: {
          changeId: id,
          selector,
          eta: new Date(etaSec * 1000).toISOString(),
          summary,
        },
        rule: "owner queued loosening change",
        outcome: `Queued change ready at ${new Date(etaSec * 1000).toISOString()}`,
      },
      txHash,
    );

    return { ok: true, status: "queued", changeId: id, eta: row?.eta };
  }

  // Check for ChangeCancelled
  if (cancelledEvents.length === 1) {
    const id = (cancelledEvents[0]!.args.changeId ?? (cancelledEvents[0]!.args as any).id).toLowerCase() as Hex;
    await db
      .update(queuedChanges)
      .set({
        status: "cancelled",
        cancelledTx: txHash,
        updatedAt: new Date(),
      })
      .where(and(eq(queuedChanges.businessId, businessId), eq(queuedChanges.changeId, id)));

    await appendAppDecision(
      db,
      businessId,
      {
        kind: "change_cancelled",
        subject: id,
        actor: user.id,
        inputs: { changeId: id },
        rule: "owner cancelled queued change",
        outcome: "Queued change cancelled",
      },
      txHash,
    );

    return { ok: true, status: "cancelled", changeId: id };
  }

  // Check for applied events
  for (const def of Object.values(CHANGE_KINDS)) {
    const appliedEvents = parseEventLogs({
      abi: symbolonVaultAbi,
      eventName: def.appliedEvent as any,
      logs: receipt.logs,
    }).filter((l) => getAddress(l.address) === vault);

    if (appliedEvents.length >= 1) {
      const tx = await client.getTransaction({ hash: txHash }).catch(() => null);
      const input = tx?.input ?? "0x";
      const id = input !== "0x" ? (keccak256(input).toLowerCase() as Hex) : ("0x" + "00".repeat(32) as Hex);
      const selector = input.length >= 10 ? input.slice(0, 10).toLowerCase() : "0x00000000";

      let summary: Record<string, unknown> = { title: def.appliedEvent };
      try {
        if (input !== "0x") {
          const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: input });
          summary = def.describe(decoded.args as readonly unknown[]);
        }
      } catch {
        // fallback
      }

      // Update existing queued row or insert applied row
      const [updated] = await db
        .update(queuedChanges)
        .set({
          status: "applied",
          appliedTx: txHash,
          updatedAt: new Date(),
        })
        .where(and(eq(queuedChanges.businessId, businessId), eq(queuedChanges.changeId, id)))
        .returning();

      if (!updated && input !== "0x") {
        await db
          .insert(queuedChanges)
          .values({
            businessId,
            kind: def.kind,
            changeId: id,
            selector,
            calldata: input,
            summary,
            createdBy: user.id,
            eta: new Date(),
            status: "applied",
            queueTx: txHash,
            appliedTx: txHash,
          })
          .onConflictDoNothing();
      }

      await appendAppDecision(
        db,
        businessId,
        {
          kind: "change_applied",
          subject: id,
          actor: user.id,
          inputs: { eventName: def.appliedEvent, summary },
          rule: "owner applied change onchain",
          outcome: `Change applied (${def.appliedEvent})`,
        },
        txHash,
      );

      return { ok: true, status: "applied", eventName: def.appliedEvent, changeId: id };
    }
  }

  throw new AuthError(409, "Transaction did not emit any expected change events.");
}

/**
 * Lists all queued changes recorded for this business.
 */
export async function listQueuedChanges(db: Database, businessId: string, user: { id: string }) {
  await requireMember(db, user.id, businessId);
  const [business] = await db.select({ vault: businesses.vault }).from(businesses).where(eq(businesses.id, businessId));
  const rows = await db
    .select()
    .from(queuedChanges)
    .where(eq(queuedChanges.businessId, businessId))
    .orderBy(desc(queuedChanges.createdAt));
  return rows.map((row) => ({ ...row, to: business?.vault ? getAddress(business.vault) : null }));
}

/**
 * Scans chain_events to find any queued changes that were queued outside of Symbolon (Q6).
 */
export async function pendingFromEvents(db: Database, businessId: string, vaultAddress: Address) {
  const vault = vaultAddress.toLowerCase();

  const queuedEvents = await db
    .select()
    .from(chainEvents)
    .where(and(eq(chainEvents.address, vault), eq(chainEvents.eventName, "ChangeQueued")));

  const cancelledEvents = await db
    .select()
    .from(chainEvents)
    .where(and(eq(chainEvents.address, vault), eq(chainEvents.eventName, "ChangeCancelled")));

  const cancelledIds = new Set(
    cancelledEvents.map((e) => ((e.args as { changeId?: string; id?: string })?.changeId ?? (e.args as { changeId?: string; id?: string })?.id)?.toLowerCase()).filter(Boolean),
  );

  const existingChanges = await db
    .select({ changeId: queuedChanges.changeId })
    .from(queuedChanges)
    .where(eq(queuedChanges.businessId, businessId));

  const knownIds = new Set(existingChanges.map((c) => c.changeId.toLowerCase()));

  const external: Array<{
    changeId: string;
    selector: string;
    eta: Date;
    source: "external";
  }> = [];

  for (const ev of queuedEvents) {
    const args = ev.args as { changeId?: string; id?: string; selector?: string; eta?: string | number };
    const id = (args.changeId ?? args.id)?.toLowerCase();
    if (!id || cancelledIds.has(id) || knownIds.has(id)) continue;

    const etaSec = Number(args.eta ?? 0);
    external.push({
      changeId: id,
      selector: String(args.selector ?? ""),
      eta: new Date(etaSec * 1000),
      source: "external",
    });
  }

  return external;
}

/**
 * Prepares a cancelQueuedChange(changeId) call for owner signing.
 */
export async function prepareCancelChange(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: { id: string; wallet?: string | null },
  businessId: string,
  changeId: Hex,
) {
  await requireMember(db, user.id, businessId, "owner");
  if (!user.wallet) throw new AuthError(403, "No wallet registered for this user.");

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business || !business.vault) {
    throw new AuthError(404, "Business Vault not found.");
  }

  const vault = getAddress(business.vault);
  const contracts = symbolonContracts(client, deployment);

  const vaultState = await contracts.lens.read.getVaultState([vault]).catch(() => {
    throw new AuthError(502, "Could not read Vault state from chain.");
  });

  if (getAddress(vaultState.owner) !== getAddress(user.wallet)) {
    throw new AuthError(403, "Your wallet is not the owner of this Vault.");
  }

  const call = vaultCall(vault, "cancelQueuedChange", [changeId]);
  const { data } = toTransaction(call);

  return {
    ok: true,
    to: vault,
    data,
    chainId: business.chainId,
    summary: { title: "Cancel queued change", details: { changeId } },
  };
}

