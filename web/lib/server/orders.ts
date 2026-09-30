import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  encodeFunctionData,
  getAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { poRef as computePoRef, formatAmount, parseAmount } from "@symbolon/seal";
import { symbolonContracts, symbolonVaultAbi, vaultCall, type Deployment } from "@symbolon/chain";
import { businesses, decisions, invoices, payees, purchaseOrders, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";
import { UNSAFE_TEXT } from "@/lib/text-safety";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const MAX_UINT256 = (1n << 256n) - 1n;
/** Maximum PO number length; spec §7.4 */
const MAX_PO_NUMBER_LENGTH = 64;
/** Maximum description length */
const MAX_DESC_LENGTH = 500;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PoLiveData {
  /** false when the lens read failed */
  ok: boolean;
  open?: boolean;
  remaining?: string;
  releaseAfter?: number;
}

export interface PurchaseOrderView {
  businessId: string;
  poRef: string;
  poNumber: string;
  seal: string;
  amount: string;
  description: string | null;
  kind: string;
  releaseAfter: Date | null;
  openTx: string | null;
  closedAt: Date | null;
  closedTx: string | null;
  createdAt: Date;
  /** Vendor display name if known */
  vendorName?: string | null;
  /** Invoices citing this PO for this business */
  invoicedTotal: bigint;
  invoiceCount: number;
  /** Paid total (from credited column) */
  paidTotal: bigint;
  /** Live chain data (null if read failed) */
  live: PoLiveData;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listOrders(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<PurchaseOrderView[]> {
  await requireMember(db, user.id, businessId);
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId)))
    .limit(1);
  if (!business?.vault) return [];

  const vault = getAddress(business.vault);
  const pos = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.businessId, businessId))
    .orderBy(desc(purchaseOrders.createdAt));

  // Load invoice aggregates for all PO refs at once
  const poRefs = pos.map((p) => p.poRef);
  const invRows =
    poRefs.length > 0
      ? await db
          .select({
            poRef: invoices.poRef,
            total: invoices.total,
            credited: invoices.credited,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.businessId, businessId),
              inArray(invoices.poRef, poRefs),
              // Exclude cancelled/rejected from "invoiced" per spec
              sql`${invoices.status} not in ('rejected', 'cancelled')`,
            ),
          )
      : [];

  // Group by poRef
  const byRef = new Map<string, { total: bigint; credited: bigint; count: number }>();
  for (const r of invRows) {
    if (!r.poRef) continue;
    const cur = byRef.get(r.poRef) ?? { total: 0n, credited: 0n, count: 0 };
    byRef.set(r.poRef, {
      total: cur.total + r.total,
      credited: cur.credited + r.credited,
      count: cur.count + 1,
    });
  }

  const c = symbolonContracts(client, deployment);

  // Read live lens data for each PO (fail gracefully per PO)
  const views: PurchaseOrderView[] = [];
  for (const po of pos) {
    let live: PoLiveData = { ok: false };
    try {
      const ref = po.poRef as Hex;
      const onchain = await c.lens.read.getPurchaseOrder([vault, ref]);
      live = {
        ok: true,
        open: onchain.open,
        remaining: onchain.remaining.toString(),
        releaseAfter: Number(onchain.releaseAfter),
      };
    } catch {
      live = { ok: false };
    }

    const agg = byRef.get(po.poRef) ?? { total: 0n, credited: 0n, count: 0 };
    views.push({
      businessId: po.businessId,
      poRef: po.poRef,
      poNumber: po.poNumber,
      seal: po.seal,
      amount: po.amount.toString(),
      description: po.description ?? null,
      kind: po.kind,
      releaseAfter: po.releaseAfter,
      openTx: po.openTx ?? null,
      closedAt: po.closedAt ?? null,
      closedTx: po.closedTx ?? null,
      createdAt: po.createdAt,
      invoicedTotal: agg.total,
      invoiceCount: agg.count,
      paidTotal: agg.credited,
      live,
    });
  }
  return views;
}

// ─── Prepare open ─────────────────────────────────────────────────────────────

export async function prepareOpenPo(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  body: {
    poNumber: unknown;
    seal: unknown;
    amount: unknown;
    description?: unknown;
    releaseDate?: unknown;
  },
) {
  await requireMember(db, user.id, businessId, "owner");

  // Validate PO number
  if (typeof body.poNumber !== "string") throw new AuthError(400, "PO number is required.");
  const poNumber = body.poNumber.trim().normalize("NFC");
  if (!poNumber || poNumber.length > MAX_PO_NUMBER_LENGTH) {
    throw new AuthError(400, `PO number must be 1–${MAX_PO_NUMBER_LENGTH} characters.`);
  }
  if (UNSAFE_TEXT.test(poNumber)) throw new AuthError(400, "PO number contains unsafe characters.");

  // Validate vendor seal
  let seal: Address;
  try {
    seal = getAddress(body.seal as string);
  } catch {
    throw new AuthError(400, "That vendor Seal address is malformed.");
  }
  const [payee] = await db
    .select({ status: payees.status })
    .from(payees)
    .where(and(eq(payees.businessId, businessId), eq(payees.seal, seal.toLowerCase())))
    .limit(1);
  const vendorVerified = payee?.status === "verified";
  // Allow opening PO for non-payee vendors with a warning (Q1: allow with warning)

  // Validate amount
  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault yet.");

  const vault = getAddress(business.vault);
  const c = symbolonContracts(client, deployment);
  const state = await c.lens.read.getVaultState([vault]).catch(() => {
    throw new AuthError(502, "Can't read Vault state right now. Try again shortly.");
  });
  const decimals = Number(state.accountingDecimals);

  let amountRaw: bigint;
  try {
    if (typeof body.amount !== "string" || !body.amount.trim()) throw new Error("empty");
    amountRaw = parseAmount(body.amount.trim(), decimals);
  } catch {
    throw new AuthError(400, "Enter a positive amount in token units (e.g. 1000.00).");
  }
  if (amountRaw <= 0n) throw new AuthError(400, "Amount must be greater than zero.");
  if (amountRaw > MAX_UINT256) throw new AuthError(400, "That amount is too large.");

  // Validate description
  let description: string | undefined;
  if (body.description !== undefined && body.description !== null && body.description !== "") {
    if (typeof body.description !== "string") throw new AuthError(400, "Description must be text.");
    description = body.description.trim();
    if (description.length > MAX_DESC_LENGTH) {
      throw new AuthError(400, `Description must be at most ${MAX_DESC_LENGTH} characters.`);
    }
    if (UNSAFE_TEXT.test(description)) throw new AuthError(400, "Description contains unsafe characters.");
  }

  // Validate release date
  let releaseAfterTs = 0n;
  if (body.releaseDate && typeof body.releaseDate === "string" && body.releaseDate.trim()) {
    const d = new Date(body.releaseDate.trim() + "T00:00:00Z");
    if (isNaN(d.getTime())) throw new AuthError(400, "Release date is not a valid date.");
    releaseAfterTs = BigInt(Math.floor(d.getTime() / 1000));
  }

  // Compute poRef
  const ref = computePoRef(poNumber);

  // N4: refuse if the lens already shows this reference, or DB already has a row
  let lensExists = false;
  try {
    const existing = await c.lens.read.getPurchaseOrder([vault, ref]);
    lensExists = existing.seal !== "0x0000000000000000000000000000000000000000";
  } catch {
    throw new AuthError(502, "Can't verify this PO number with the Vault right now. Try again shortly.");
  }
  if (lensExists) {
    throw new AuthError(
      409,
      "That PO number already exists in this Vault. Close it and use a new number.",
    );
  }
  const [dbRow] = await db
    .select({ poRef: purchaseOrders.poRef })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.poRef, ref)))
    .limit(1);
  if (dbRow) {
    throw new AuthError(
      409,
      "That PO number already exists in this Vault. Close it and use a new number.",
    );
  }

  // Budget: use OPERATING_BUDGET (bytes32(0)) from the Vault
  const budgetId = await client
    .readContract({
      address: vault,
      abi: symbolonVaultAbi,
      functionName: "OPERATING_BUDGET",
    })
    .catch(() => {
      throw new AuthError(502, "Can't read this Vault's budget right now.");
    });

  const call = vaultCall(vault, "openPurchaseOrder", [ref, seal, budgetId, amountRaw, releaseAfterTs]);
  const data = encodeFunctionData({
    abi: symbolonVaultAbi,
    functionName: call.functionName,
    args: call.args,
  });

  const amountDisplay = formatAmount(amountRaw, decimals);
  const releaseDisplay = releaseAfterTs > 0n
    ? new Date(Number(releaseAfterTs) * 1000).toISOString().slice(0, 10) + " UTC"
    : "No release date";

  return {
    to: call.address,
    data,
    chainId: deployment.chainId,
    poRef: ref,
    poNumber,
    description: description ?? null,
    releaseAfterTs: releaseAfterTs.toString(),
    vendorWarning: !vendorVerified
      ? "This vendor is not yet an onchain payee — their invoices can't be paid until they are."
      : null,
    summary: {
      poNumber,
      seal: seal.toLowerCase(),
      amount: amountDisplay,
      token: "token units",
      releaseDate: releaseDisplay,
      signerSuffix: "your wallet",
    },
  };
}

// ─── Record open ──────────────────────────────────────────────────────────────

export async function recordOpenPo(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  txHash: unknown,
  poNumber: unknown,
  description: unknown,
) {
  await requireMember(db, user.id, businessId, "owner");
  if (typeof txHash !== "string" || !HASH_RE.test(txHash)) {
    throw new AuthError(400, "That isn't a transaction hash.");
  }
  if (typeof poNumber !== "string" || !poNumber.trim()) {
    throw new AuthError(400, "PO number is required to record the receipt.");
  }

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  const vault = getAddress(business.vault);

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    throw new AuthError(409, "That transaction isn't confirmed yet. Try again shortly.");
  }
  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) {
    throw new AuthError(409, "That transaction wasn't a successful call to this Vault.");
  }

  const events = parseEventLogs({
    abi: symbolonVaultAbi,
    eventName: "PurchaseOrderOpened",
    logs: receipt.logs,
  }).filter((l) => getAddress(l.address) === vault);
  if (events.length !== 1) {
    throw new AuthError(409, "That transaction didn't open exactly one purchase order in this Vault.");
  }

  const ev = events[0]!.args;
  // Verify the poNumber hashes to the event's poRef (N5)
  const trimmed = (poNumber as string).trim().normalize("NFC");
  const expectedRef = computePoRef(trimmed);
  if (ev.poRef !== expectedRef) {
    throw new AuthError(
      409,
      "The PO number doesn't match the order in that receipt. Check the number and try again.",
    );
  }

  // Verify the seal has a verified payee row (or at least is known — warning was shown at prepare time)
  const [payeeRow] = await db
    .select({ status: payees.status })
    .from(payees)
    .where(and(eq(payees.businessId, businessId), eq(payees.seal, ev.seal.toLowerCase())))
    .limit(1);

  // Re-check against the lens
  const c = symbolonContracts(client, deployment);
  const onchain = await c.lens.read.getPurchaseOrder([vault, ev.poRef]).catch(() => {
    throw new AuthError(502, "Can't confirm the PO against the Vault right now. Try again.");
  });
  if (!onchain.open || getAddress(onchain.seal) !== getAddress(ev.seal)) {
    throw new AuthError(409, "The Vault's purchase order doesn't match the receipt. Try again shortly.");
  }

  // Idempotent on open_tx
  const [already] = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.businessId, businessId),
        eq(decisions.kind, "po_opened"),
        sql`${decisions.record}->'inputs'->>'txHash' = ${txHash}`,
      ),
    )
    .limit(1);
  if (already) {
    return { poRef: ev.poRef, poNumber: trimmed, txHash };
  }

  const budgetId = await client
    .readContract({ address: vault, abi: symbolonVaultAbi, functionName: "OPERATING_BUDGET" })
    .catch(() => "0x" + "00".repeat(32));

  await db
    .insert(purchaseOrders)
    .values({
      businessId,
      poRef: ev.poRef,
      poNumber: trimmed,
      seal: ev.seal.toLowerCase(),
      budget: budgetId as string,
      amount: ev.amount,
      description: typeof description === "string" && description.trim() ? description.trim() : null,
      kind: "one_off",
      releaseAfter: ev.releaseAfter > 0n ? new Date(Number(ev.releaseAfter) * 1000) : null,
      openTx: txHash.toLowerCase(),
      createdBy: user.id,
    })
    .onConflictDoNothing();

  await appendAppDecision(db, businessId, {
    kind: "po_opened",
    subject: ev.poRef,
    actor: user.id,
    inputs: {
      txHash,
      poNumber: trimmed,
      poRef: ev.poRef,
      seal: ev.seal.toLowerCase(),
      amount: ev.amount.toString(),
      releaseAfter: ev.releaseAfter.toString(),
      payeeStatus: payeeRow?.status ?? "unknown",
    },
    rule: "verified Vault receipt with PurchaseOrderOpened event",
    outcome: "po_opened",
  });

  return { poRef: ev.poRef, poNumber: trimmed, txHash };
}

// ─── Prepare close ────────────────────────────────────────────────────────────

export async function prepareClosePo(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  poRefValue: unknown,
) {
  await requireMember(db, user.id, businessId, "owner");
  if (typeof poRefValue !== "string" || !HASH_RE.test(poRefValue)) {
    throw new AuthError(400, "That PO reference is malformed.");
  }

  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.poRef, poRefValue)))
    .limit(1);
  if (!po) throw new AuthError(404, "That purchase order doesn't exist for this business.");
  if (po.closedAt) throw new AuthError(409, "That purchase order is already closed.");

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  const vault = getAddress(business.vault);

  const c = symbolonContracts(client, deployment);
  const onchain = await c.lens.read.getPurchaseOrder([vault, poRefValue as Hex]).catch(() => {
    throw new AuthError(502, "Can't verify the purchase order's status with the Vault right now.");
  });
  if (!onchain.open) {
    throw new AuthError(409, "That purchase order is already closed onchain.");
  }

  const call = vaultCall(vault, "closePurchaseOrder", [poRefValue as Hex]);
  const data = encodeFunctionData({
    abi: symbolonVaultAbi,
    functionName: call.functionName,
    args: call.args,
  });

  return {
    to: call.address,
    data,
    chainId: deployment.chainId,
    poRef: poRefValue,
    summary: {
      poNumber: po.poNumber,
      action: "Close this order — no more invoices can be matched against it after this.",
    },
  };
}

// ─── Record close ─────────────────────────────────────────────────────────────

export async function recordClosePo(
  db: Database,
  client: PublicClient,
  deployment: Deployment,
  user: Pick<SessionUser, "id">,
  businessId: string,
  txHash: unknown,
  poRefValue: unknown,
) {
  await requireMember(db, user.id, businessId, "owner");
  if (typeof txHash !== "string" || !HASH_RE.test(txHash)) {
    throw new AuthError(400, "That isn't a transaction hash.");
  }
  if (typeof poRefValue !== "string" || !HASH_RE.test(poRefValue)) {
    throw new AuthError(400, "That PO reference is malformed.");
  }

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  const vault = getAddress(business.vault);

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    throw new AuthError(409, "That transaction isn't confirmed yet. Try again shortly.");
  }
  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) {
    throw new AuthError(409, "That transaction wasn't a successful call to this Vault.");
  }

  const events = parseEventLogs({
    abi: symbolonVaultAbi,
    eventName: "PurchaseOrderClosed",
    logs: receipt.logs,
  }).filter((l) => getAddress(l.address) === vault);
  if (events.length !== 1) {
    throw new AuthError(409, "That transaction didn't close exactly one purchase order in this Vault.");
  }

  const ev = events[0]!.args;
  if (ev.poRef !== poRefValue) {
    throw new AuthError(409, "That receipt closed a different purchase order.");
  }

  // Idempotent on closed_tx
  const [already] = await db
    .select({ poRef: purchaseOrders.poRef })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.businessId, businessId),
        eq(purchaseOrders.poRef, poRefValue),
        sql`${purchaseOrders.closedTx} = ${txHash.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (already) return { poRef: poRefValue, txHash };

  const now = new Date();
  await db
    .update(purchaseOrders)
    .set({ closedAt: now, closedTx: txHash.toLowerCase() })
    .where(
      and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.poRef, poRefValue)),
    );

  await appendAppDecision(db, businessId, {
    kind: "po_closed",
    subject: poRefValue,
    actor: user.id,
    inputs: { txHash, poRef: poRefValue },
    rule: "verified Vault receipt with PurchaseOrderClosed event",
    outcome: "po_closed",
  });

  return { poRef: poRefValue, txHash };
}
