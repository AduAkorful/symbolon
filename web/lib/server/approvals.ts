import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  getAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { simulateCall, symbolonContracts, symbolonVaultAbi, toTransaction } from "@symbolon/chain";
import { createInvoiceInputReader, readVaultFacts, recordApproval, syncLedger, syncVault } from "@symbolon/core";
import {
  businesses,
  decisions,
  deliveries,
  invoices,
  payees,
  purchaseOrders,
  seals,
  users,
  type Database,
} from "@symbolon/db";
import {
  decodeSealedInvoice,
  sealDomain,
  typedData,
  typedDataJson,
  verifySealedInvoice,
} from "@symbolon/seal";
import {
  ApprovalLevel,
  checkPayment,
  findDuplicates,
  matchInvoice,
  processInvoice,
  type InvoiceContext,
  type StewardResult,
} from "@symbolon/steward";

import { UNSAFE_TEXT } from "@/lib/text-safety";
import { requireMember, type Role } from "./access";
import { appendAppDecision } from "./app-decisions";
import type { ChainSettings } from "./business";
import { summarizeDecision } from "./decision-text";
import { AuthError } from "./errors";
import { evidenceFor, type EvidenceRow } from "./match-view";
import type { SessionUser } from "./session";
import { readPaymentBudget, readPaymentLedger, verifyPaymentDocument } from "./payment-ledger";
import { buildStewardEnv } from "./steward-runtime";

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 500;
export const APPROVAL_VALIDITY_SECONDS = 86_400n; // 24 hours (Decision A4 / Q2)
const ZERO32: Hex = `0x${"00".repeat(32)}`;

const VIEW_ROLES: Role[] = ["owner", "approver", "requester", "viewer"];
const ACTION_ROLES: Role[] = ["owner", "approver"];

export interface ApprovalItem {
  fingerprint: string;
  invoiceNumber: string;
  vendor: {
    name: string;
    seal: string;
    trust: "verified" | "new_vendor" | "blocked" | "failed";
  };
  amountFormatted: string;
  rawAmount: string;
  token: string;
  dueDate: Date | null;
  receivedAt: Date;
  stewardSentence: string;
  explanation?: string;
  ruleNeededHuman: string;
  requiredLevel: "owner" | "approver";
  evidence: EvidenceRow[];
  canSign: boolean;
  canPayNow: boolean;
  canReject: boolean;
}

export interface RecentAnswer {
  id: string;
  kind: "approval_granted" | "approval_rejected";
  fingerprint: string;
  actor?: string;
  reason?: string;
  credit?: string;
  createdAt: Date;
}

export interface HumanResponseMetric {
  agreed: number;
  total: number;
  text: string;
}

export interface ApprovalsListResult {
  items: ApprovalItem[];
  recentAnswers: RecentAnswer[];
  humanMetric: HumanResponseMetric | null;
  mode: string;
  callerRole: Role;
  userWallet: string | null;
}

function formatAmount(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

/**
 * Lists invoices awaiting human approval (status = 'awaiting_approval') along with
 * recent approval/rejection decisions and the human agreement metric (Decision A7 & A8).
 */
export async function listApprovals(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
): Promise<ApprovalsListResult> {
  const member = await requireMember(db, user.id, businessId, ...VIEW_ROLES);
  const [biz] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), eq(businesses.chainId, cfg.chainId)))
    .limit(1);
  if (!biz) throw new AuthError(404, "That business doesn't exist.");
  if (!biz.vault) throw new AuthError(409, "This business doesn't have a Vault yet.");

  const [dbUser] = await db.select({ wallet: seals.address }).from(seals).where(eq(seals.userId, user.id)).limit(1);
  const [callerUser] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, user.id)).limit(1);
  // Read user's primary wallet
  const userWallet = callerUser?.wallet?.toLowerCase() ?? dbUser?.wallet?.toLowerCase() ?? null;

  const vault = getAddress(biz.vault);
  const contracts = symbolonContracts(client, cfg.deployment);
  let vaultOwner: Address | null = null;
  try {
    const state = await contracts.lens.read.getVaultState([vault]);
    vaultOwner = state.owner;
  } catch {
    // Lens read best effort
  }

  const isVaultOwner = userWallet && vaultOwner && userWallet.toLowerCase() === vaultOwner.toLowerCase();

  // Load awaiting_approval invoices
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.status, "awaiting_approval")))
    .orderBy(desc(invoices.receivedAt));

  const items: ApprovalItem[] = [];

  for (const row of rows) {
    let doc: any = null;
    let inv: any = null;
    let verification: any = null;
    try {
      verification = await verifySealedInvoice(row.envelope, {
        client,
        expected: { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
      });
      doc = verification.document;
      inv = verification.invoice;
    } catch {
      // verification failed
    }

    const [payeeRow] = await db
      .select({ status: payees.status })
      .from(payees)
      .where(and(eq(payees.businessId, businessId), eq(payees.seal, row.seal)))
      .limit(1);

    const trust = payeeRow?.status === "blocked" ? "blocked" : payeeRow?.status === "verified" ? "verified" : "new_vendor";

    // Load latest decision for this invoice
    const [latestDec] = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, row.fingerprint.toLowerCase())))
      .orderBy(desc(decisions.createdAt))
      .limit(1);

    const decRecord = (latestDec?.record as Record<string, unknown>) ?? {};
    const summary = summarizeDecision(decRecord);
    const ruleNeededHuman = String(decRecord.rule ?? "Approval required");
    const requiredLevel: "owner" | "approver" = ruleNeededHuman.toLowerCase().includes("owner") ? "owner" : "approver";

    // Match and evidence
    let facts: any;
    let match: any;
    let ledger: any;
    try {
      if (inv) {
        facts = await readVaultFacts(contracts, client, vault, inv, row.fingerprint as Hex);
        match = matchInvoice(inv, facts.payee?.terms, facts.purchaseOrder, facts.deliveryConfirmed, facts.now);
      }
    } catch {
      // best effort
    }

    const [dbDelivery] = await db
      .select({ state: deliveries.state, reason: deliveries.reason, txHash: deliveries.txHash })
      .from(deliveries)
      .where(and(eq(deliveries.businessId, businessId), eq(deliveries.fingerprint, row.fingerprint)))
      .limit(1);

    let dbPo: any = undefined;
    if (inv?.poRef && inv.poRef !== ZERO32) {
      const [poRow] = await db
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.poRef, inv.poRef)))
        .limit(1);
      if (poRow) {
        dbPo = {
          poNumber: poRow.poNumber,
          open: !poRow.closedAt,
          remainingRaw: null,
          releaseAfter: poRow.releaseAfter ?? null,
          openTx: poRow.openTx ?? null,
          closedAt: poRow.closedAt ?? null,
        };
      }
    }

    const ev = evidenceFor({
      verification: verification ?? { ok: false, issues: [] },
      invoice: inv,
      trust,
      facts,
      ledger,
      match,
      dbDelivery: dbDelivery ?? undefined,
      dbPo,
    });

    const isAuthorizedMember = member.role === "owner" || member.role === "approver";
    const userMeetsLevel = isVaultOwner || (requiredLevel === "approver" && isAuthorizedMember);

    // Can sign: only in auto mode (Decision A1 & A4)
    const canSign = Boolean(biz.stewardMode === "auto" && userWallet && userMeetsLevel);
    // Can pay now: available in every mode (Decision A1 & A2)
    const canPayNow = Boolean(userWallet && userMeetsLevel);
    const canReject = isAuthorizedMember;

    const decimals = doc?.currency?.decimals ?? 6;
    items.push({
      fingerprint: row.fingerprint,
      invoiceNumber: row.invoiceNumber ?? doc?.invoiceNumber ?? "Unknown",
      vendor: {
        name: doc?.vendor?.name ?? "Unknown vendor",
        seal: row.seal,
        trust,
      },
      amountFormatted: doc ? formatAmount(row.total, decimals) : row.total.toString(),
      rawAmount: row.total.toString(),
      token: doc?.currency?.symbol ?? "USDC",
      dueDate: row.dueDate,
      receivedAt: row.receivedAt,
      stewardSentence: summary.sentence,
      explanation: summary.explanation,
      ruleNeededHuman,
      requiredLevel,
      evidence: ev.rows,
      canSign,
      canPayNow,
      canReject,
    });
  }

  // Load recent answers (granted or rejected)
  const recentDecRows = await db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.businessId, businessId),
        inArray(decisions.kind, ["approval_granted", "approval_rejected"]),
      ),
    )
    .orderBy(desc(decisions.createdAt))
    .limit(10);

  const recentAnswers: RecentAnswer[] = recentDecRows.map((r) => {
    const rec = (r.record as Record<string, unknown>) ?? {};
    return {
      id: r.id,
      kind: r.kind as "approval_granted" | "approval_rejected",
      fingerprint: r.subject ?? "",
      actor: typeof rec.actor === "string" ? rec.actor : typeof rec.signer === "string" ? rec.signer : undefined,
      reason: typeof rec.reason === "string" ? rec.reason : undefined,
      credit: typeof rec.credit === "string" ? rec.credit : undefined,
      createdAt: r.createdAt,
    };
  });

  // Calculate human metric from latest linked eligible responses (Decision A7).
  const { humanResponseAgreement } = await import("@symbolon/core");
  const metric = await humanResponseAgreement(db, businessId);
  const humanMetric: HumanResponseMetric | null = metric.total > 0 ? {
    ...metric,
    text: `You agreed with ${metric.agreed} of ${metric.total} recommendations`,
  } : null;

  return {
    items,
    recentAnswers,
    humanMetric,
    mode: biz.stewardMode,
    callerRole: member.role as Role,
    userWallet,
  };
}

/**
 * Prepares an EIP-712 Approval message for an approver or owner to sign (Decision A4).
 * Only offered when business is in 'auto' mode.
 */
export async function prepareApproval(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  fingerprintValue: unknown,
) {
  await requireMember(db, user.id, businessId, ...ACTION_ROLES);
  if (typeof fingerprintValue !== "string" || !HASH_RE.test(fingerprintValue)) {
    throw new AuthError(400, "Malformed invoice fingerprint.");
  }
  const fingerprint = fingerprintValue.toLowerCase() as Hex;

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  if (biz.stewardMode !== "auto") {
    throw new AuthError(
      400,
      "Approving by signature is only available in autonomous mode. Use 'Approve and pay' to send the transaction directly from your wallet.",
    );
  }

  const [invRow] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)))
    .limit(1);
  if (!invRow) throw new AuthError(404, "Invoice not found.");
  if (invRow.status !== "awaiting_approval") {
    throw new AuthError(409, `This invoice is not awaiting approval (current status: ${invRow.status}).`);
  }

  const [callerUser] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, user.id)).limit(1);
  const userWallet = callerUser?.wallet ? getAddress(callerUser.wallet) : null;
  if (!userWallet) throw new AuthError(400, "Sign-in wallet required to approve payments.");

  const vault = getAddress(biz.vault);
  const contracts = symbolonContracts(client, cfg.deployment);
  const vaultState = await contracts.lens.read.getVaultState([vault]).catch(() => {
    throw new AuthError(502, "Can't read Vault state from the chain right now. Try again shortly.");
  });

  const { invoice } = await verifyPaymentDocument(client, cfg, invRow.envelope, fingerprint);
  const isOwner = userWallet.toLowerCase() === vaultState.owner.toLowerCase();
  const budgetId = isOwner ? ZERO32 : await readPaymentBudget(contracts, vault, invoice);
  const isApprover =
    isOwner ||
    (await contracts.lens.read.isApprover([vault, userWallet, budgetId]).catch(() => {
      throw new AuthError(502, "Can't confirm your onchain approval role right now.");
    }));

  if (!isApprover) {
    throw new AuthError(403, "Your connected wallet is neither the Vault owner nor an authorized approver.");
  }

  // Check required level from latest decision
  const [latestDec] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, fingerprint)))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  const rule = String((latestDec?.record as any)?.rule ?? "");
  if (rule.toLowerCase().includes("owner") && !isOwner) {
    throw new AuthError(403, "This payment exceeds the approver limit and requires the Vault owner's signature.");
  }

  const ledger = await readPaymentLedger(contracts, fingerprint, invoice.amount);
  if (ledger.cancelled || ledger.settled || ledger.credit === 0n) {
    throw new AuthError(409, "This invoice is already settled or cancelled onchain.");
  }
  const remaining = ledger.credit;

  const block = await client.getBlock().catch(() => {
    throw new AuthError(502, "Can't read chain time for this approval right now.");
  });
  const deadline = block.timestamp + APPROVAL_VALIDITY_SECONDS;
  const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);
  const approvalMessage = {
    vault,
    fingerprint,
    credit: remaining,
    deadline,
  };
  const typedDataObj = typedData(domain, "Approval", approvalMessage);
  const typedDataJsonString = typedDataJson(domain, "Approval", approvalMessage);

  return {
    ok: true,
    // The Seal package supplies the exact eth_signTypedData_v4 payload, including EIP712Domain.
    typedData: JSON.parse(typedDataJsonString) as Omit<typeof typedDataObj, "message"> & {
      message: { vault: Address; fingerprint: Hex; credit: string; deadline: string };
    },
    typedDataJson: typedDataJsonString,
    credit: remaining.toString(),
    deadline: deadline.toString(),
    vault,
    fingerprint,
    summary: {
      vault,
      fingerprint,
      creditRaw: remaining.toString(),
      deadline: new Date(Number(deadline) * 1000).toISOString(),
    },
  };
}

/**
 * Stores an approver's or owner's verified EIP-712 Approval and records the approval_granted decision (Decision A4 & A5).
 */
export async function submitApproval(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  body: {
    fingerprint?: unknown;
    deadline?: unknown;
    signature?: unknown;
  },
) {
  await requireMember(db, user.id, businessId, ...ACTION_ROLES);
  if (typeof body.fingerprint !== "string" || !HASH_RE.test(body.fingerprint)) {
    throw new AuthError(400, "Malformed invoice fingerprint.");
  }
  const fingerprint = body.fingerprint.toLowerCase() as Hex;

  if (typeof body.signature !== "string" || !/^0x[0-9a-fA-F]{130,}$/.test(body.signature)) {
    throw new AuthError(400, "Malformed approval signature.");
  }
  const signature = body.signature as Hex;

  let deadline: bigint;
  try {
    deadline = BigInt(String(body.deadline));
  } catch {
    throw new AuthError(400, "Invalid approval deadline.");
  }

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  const vault = getAddress(biz.vault);

  const [callerUser] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, user.id)).limit(1);
  const userWallet = callerUser?.wallet ? getAddress(callerUser.wallet) : null;
  if (!userWallet) throw new AuthError(400, "Sign-in wallet required to submit approval.");

  // Re-check the same eligibility and verified ledger credit at submission; no body-supplied amount.
  const prepared = await prepareApproval(db, client, cfg, user, businessId, fingerprint);
  const remaining = BigInt(prepared.credit);
  const nowSec = BigInt(prepared.deadline) - APPROVAL_VALIDITY_SECONDS;
  if (deadline <= nowSec || deadline > BigInt(prepared.deadline)) {
    throw new AuthError(400, "Approval deadline is expired or exceeds the approval validity window.");
  }

  // Record approval in DB (checks signature with verifySealSignature and updates if deadline is later — A5)
  await recordApproval(
    db,
    { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
    {
      businessId,
      vault,
      fingerprint,
      credit: remaining,
      deadline,
      signer: userWallet,
      signature,
    },
    { client },
  );

  // Find latest recommendation decision hash to link
  const [recDec] = await db
    .select({ hash: decisions.hash })
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, fingerprint),
      sql`${decisions.record}->>'outcome' IN ('request_approval', 'proposed')`,
      sql`${decisions.kind} NOT IN ('approval_granted', 'approval_rejected')`))
    .orderBy(desc(decisions.createdAt))
    .limit(1);

  await appendAppDecision(db, businessId, {
    kind: "approval_granted",
    subject: fingerprint,
    actor: user.id,
    inputs: {
      ...(recDec?.hash ? { recommendation: recDec.hash } : {}),
      credit: remaining.toString(),
      deadline: deadline.toString(),
      signer: userWallet,
    },
    rule: "authorized approver signed EIP-712 approval",
    outcome: "approval_granted",
  });

  return { ok: true, signer: userWallet };
}

/**
 * Rejects an invoice awaiting approval, marking it held with hold_source = 'human' (Decision A6).
 */
export async function rejectApproval(
  db: Database,
  _client: PublicClient,
  _cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  body: {
    fingerprint?: unknown;
    reason?: unknown;
  },
) {
  await requireMember(db, user.id, businessId, ...ACTION_ROLES);
  if (typeof body.fingerprint !== "string" || !HASH_RE.test(body.fingerprint)) {
    throw new AuthError(400, "Malformed invoice fingerprint.");
  }
  const fingerprint = body.fingerprint.toLowerCase() as Hex;

  if (typeof body.reason !== "string" || !body.reason.trim()) {
    throw new AuthError(400, "A rejection reason is required.");
  }
  if (UNSAFE_TEXT.test(body.reason)) {
    throw new AuthError(400, "Rejection reason contains unsafe characters.");
  }
  const reason = body.reason.trim();
  if (reason.length < MIN_REASON_LENGTH) {
    throw new AuthError(400, `Rejection reason must be at least ${MIN_REASON_LENGTH} characters.`);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new AuthError(400, `Rejection reason must be at most ${MAX_REASON_LENGTH} characters.`);
  }

  const [invRow] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)))
    .limit(1);
  if (!invRow) throw new AuthError(404, "Invoice not found.");
  if (invRow.status !== "awaiting_approval") {
    throw new AuthError(409, `Only invoices awaiting approval can be rejected (current status: ${invRow.status}).`);
  }

  const [recDec] = await db
    .select({ hash: decisions.hash })
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, fingerprint),
      sql`${decisions.record}->>'outcome' IN ('request_approval', 'proposed')`,
      sql`${decisions.kind} NOT IN ('approval_granted', 'approval_rejected')`))
    .orderBy(desc(decisions.createdAt))
    .limit(1);

  await appendAppDecision(db, businessId, {
    kind: "approval_rejected",
    subject: fingerprint,
    actor: user.id,
    inputs: {
      ...(recDec?.hash ? { recommendation: recDec.hash } : {}),
      reason,
    },
    rule: "payment rejected by authorized user",
    outcome: "approval_rejected",
  });

  await db
    .update(invoices)
    .set({ status: "held", holdSource: "human", holdKind: "payment" })
    .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)));

  return { ok: true, status: "held" as const, holdSource: "human" as const };
}

/**
 * Prepares a call for the approver/owner's wallet to pay directly from their wallet (Decision A1 & A2).
 * Re-runs processInvoice with mode='assist' and approvalHeld=user's level.
 * Simulates before returning.
 */
export async function preparePayNow(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  fingerprintValue: unknown,
) {
  await requireMember(db, user.id, businessId, ...ACTION_ROLES);
  if (typeof fingerprintValue !== "string" || !HASH_RE.test(fingerprintValue)) {
    throw new AuthError(400, "Malformed invoice fingerprint.");
  }
  const fingerprint = fingerprintValue.toLowerCase() as Hex;

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  const vault = getAddress(biz.vault);

  const [callerUser] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, user.id)).limit(1);
  const userWallet = callerUser?.wallet ? getAddress(callerUser.wallet) : null;
  if (!userWallet) throw new AuthError(400, "Sign-in wallet required to send payments.");

  const [invRow] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)))
    .limit(1);
  if (!invRow) throw new AuthError(404, "Invoice not found.");
  if (invRow.holdSource === "human") {
    return { ok: false, reason: "The owner must release this human payment hold before paying." };
  }

  const contracts = symbolonContracts(client, cfg.deployment);
  const vaultState = await contracts.lens.read.getVaultState([vault]).catch(() => {
    throw new AuthError(502, "Can't read Vault state from the chain right now. Try again shortly.");
  });

  const { invoice: inv, document: doc } = await verifyPaymentDocument(client, cfg, invRow.envelope, fingerprint);

  const facts = await readVaultFacts(contracts, client, vault, inv, fingerprint).catch(() => {
    throw new AuthError(502, "Can't read Vault facts from the chain.");
  });
  const ledger = await readPaymentLedger(contracts, fingerprint, inv.amount);
  if (ledger.cancelled || ledger.settled || ledger.credit === 0n) {
    return { ok: false, reason: "This invoice is already settled or cancelled onchain." };
  }
  const budgetId = checkPayment(facts, {
    invoice: inv, credit: ledger.credit, paid: ledger.credit, maxFee: 0n, approvalHeld: ApprovalLevel.Owner,
  }).budgetId;
  const isOwner = userWallet.toLowerCase() === vaultState.owner.toLowerCase();
  const isApprover = isOwner || await contracts.lens.read.isApprover([vault, userWallet, budgetId]).catch(() => {
    throw new AuthError(502, "Can't confirm your onchain approval role right now.");
  });
  const callerLevel = isOwner ? ApprovalLevel.Owner : isApprover ? ApprovalLevel.Approver : ApprovalLevel.None;
  if (callerLevel === ApprovalLevel.None) {
    throw new AuthError(403, "Your connected wallet is not authorized to send payments from this Vault.");
  }
  const env = await buildStewardEnv(db, client, cfg, biz);
  const businessInputs = await createInvoiceInputReader(env, businessId, vault)
    .then((reader) => reader.forInvoice(invRow, facts.now)).catch(() => {
      throw new AuthError(502, "Can't read this business's payment controls and cash right now.");
    });

  // Re-run pipeline for this invoice (Decision A2)
  const ctx: InvoiceContext = {
    business: { id: biz.id, vault, mode: "assist", program: env.program },
    deployment: { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
    envelope: invRow.envelope,
    facts,
    ledgerRemaining: ledger.ledgerRemaining,
    ...businessInputs,
    reserveYieldBps: env.reserveYieldBps,
    signatureClient: client,
    approvalHeld: callerLevel,
  };

  const processed = await processInvoice(ctx, {
    simulate: async () => { throw new Error("Assist preflight never sends through the Steward."); },
  });

  if (processed.outcome !== "proposed" || !processed.call) {
    await storePayNowDecision(db, businessId, fingerprint, processed);
    return {
      ok: false,
      reason: processed.record.rule || `Payment not payable: outcome is ${processed.outcome}`,
    };
  }

  // Simulate call as the user's wallet before opening wallet window (Decision A2)
  try {
    await simulateCall(client, processed.call, userWallet);
  } catch (simError) {
    const error = simError as { shortMessage?: string; message?: string };
    return {
      ok: false,
      reason: "Vault simulation failed: " + (error.shortMessage || error.message || "transaction would revert"),
    };
  }

  // Store the decision record with hash matching the onchain decisionHash (Decision A2)
  await storePayNowDecision(db, businessId, fingerprint, processed);

  const creditRaw = ledger.credit;
  const paidRaw = BigInt(String(processed.record.inputs.paid));
  const decimals = doc.currency.decimals ?? 6;

  return {
    ok: true,
    to: processed.call.address,
    data: toTransaction(processed.call).data,
    chainId: cfg.chainId,
    summary: {
      vendor: doc.vendor.name,
      invoiceNumber: doc.invoiceNumber,
      amount: formatAmount(paidRaw, decimals),
      credit: formatAmount(creditRaw, decimals),
      discountSigned: paidRaw < creditRaw,
      discountRaw: (creditRaw - paidRaw).toString(),
      payoutAddress: inv.payoutAddress,
      fee: "0 USDC",
      ruleNeededHuman: processed.record.rule,
      signerWallet: userWallet,
    },
  };
}

async function storePayNowDecision(db: Database, businessId: string, fingerprint: Hex, processed: StewardResult) {
  await db.insert(decisions).values({
    businessId, kind: processed.record.kind, subject: fingerprint,
    record: processed.record as unknown as Record<string, unknown>, hash: processed.hash.toLowerCase(),
  }).onConflictDoNothing();
}

/**
 * Records a payment confirmed onchain from an approver/owner wallet (Decision A3).
 * Checks receipt, validates Paid event and stored decisionHash, updates decisions, and syncs ledger.
 */
export async function recordPayNow(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  txHashValue: unknown,
  fingerprintValue: unknown,
) {
  await requireMember(db, user.id, businessId, ...ACTION_ROLES);
  if (typeof txHashValue !== "string" || !HASH_RE.test(txHashValue)) {
    throw new AuthError(400, "Malformed transaction hash.");
  }
  const txHash = txHashValue.toLowerCase() as Hex;

  if (typeof fingerprintValue !== "string" || !HASH_RE.test(fingerprintValue)) {
    throw new AuthError(400, "Malformed invoice fingerprint.");
  }
  const fingerprint = fingerprintValue.toLowerCase() as Hex;

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz?.vault) throw new AuthError(409, "This business doesn't have a Vault.");
  const vault = getAddress(biz.vault);

  const [callerUser] = await db.select({ wallet: users.wallet }).from(users).where(eq(users.id, user.id)).limit(1);
  const userWallet = callerUser?.wallet ? getAddress(callerUser.wallet) : null;
  if (!userWallet) throw new AuthError(400, "Sign-in wallet required to record payments.");

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    throw new AuthError(409, "That transaction isn't confirmed yet. Try again shortly.");
  }

  if (receipt.status !== "success" || !receipt.to || getAddress(receipt.to) !== vault) {
    throw new AuthError(409, "That successful transaction was not sent to this business's Vault.");
  }

  const paidEvents = parseEventLogs({ abi: symbolonVaultAbi, eventName: "Paid", logs: receipt.logs }).filter(
    (l) => getAddress(l.address) === vault && l.args.fingerprint.toLowerCase() === fingerprint.toLowerCase(),
  );

  if (paidEvents.length !== 1) {
    throw new AuthError(409, "That transaction did not emit exactly one Paid event for this invoice.");
  }

  const paid = paidEvents[0]!;
  if (paid.args.caller.toLowerCase() !== userWallet.toLowerCase()) {
    throw new AuthError(409, "The transaction caller onchain does not match your connected wallet.");
  }

  // Verify decisionHash points to a recorded decision for this business (Decision A3)
  const [recordedDec] = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.businessId, businessId),
        eq(decisions.hash, paid.args.decisionHash.toLowerCase()),
      ),
    )
    .limit(1);

  if (!recordedDec) {
    throw new AuthError(409, "The onchain decision hash does not match any decision recorded for this business.");
  }

  // Idempotently record superseding tx decision
  const [existingTx] = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.businessId, businessId),
        eq(decisions.kind, "pay"),
        sql`${decisions.record}->'inputs'->>'txHash' = ${txHash}`,
      ),
    )
    .limit(1);

  if (!existingTx) {
    await appendAppDecision(db, businessId, {
      kind: "pay",
      subject: fingerprint,
      actor: user.id,
      inputs: {
        txHash,
        caller: userWallet,
        decisionHash: paid.args.decisionHash,
        credit: paid.args.credit.toString(),
        paid: paid.args.paid.toString(),
      },
      rule: "payment confirmed onchain by wallet",
      outcome: "paid",
    });
  }

  // Sync ledger immediately so the invoice's status and credited come from the ledger
  const contracts = symbolonContracts(client, cfg.deployment);
  await syncVault(db, client, cfg.deployment, vault);
  await syncLedger(db, client, contracts, cfg.deployment);

  return { ok: true, txHash };
}

/**
 * Releases a human hold placed on an invoice (owner only, Decision A6).
 */
export async function releaseHold(
  db: Database,
  _client: PublicClient,
  _cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  fingerprintValue: unknown,
) {
  // Release hold requires owner role (Decision A6 & A15)
  await requireMember(db, user.id, businessId, "owner");
  if (typeof fingerprintValue !== "string" || !HASH_RE.test(fingerprintValue)) {
    throw new AuthError(400, "Malformed invoice fingerprint.");
  }
  const fingerprint = fingerprintValue.toLowerCase() as Hex;

  const [invRow] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)))
    .limit(1);

  if (!invRow) throw new AuthError(404, "Invoice not found.");
  if (invRow.status !== "held" || invRow.holdSource !== "human") {
    throw new AuthError(409, "Only human-held invoices can be released with this action.");
  }

  await db
    .update(invoices)
    .set({ status: "verified", holdSource: null, holdKind: null })
    .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, fingerprint)));

  await appendAppDecision(db, businessId, {
    kind: "hold_released",
    subject: fingerprint,
    actor: user.id,
    inputs: { fingerprint },
    rule: "owner released human hold",
    outcome: "hold_released",
  });

  return { ok: true, status: "verified" as const, holdSource: null };
}
