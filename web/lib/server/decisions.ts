import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { erc20Abi, getAddress, type Hex, type PublicClient } from "viem";

import { businesses, chainEvents, decisions, invoices, members, users, type Database } from "@symbolon/db";
import { hashRecord, type DecisionRecord } from "@symbolon/steward";

import { requireMember, type Role } from "./access";
import { anchorState, type DecisionAnchorInfo } from "./anchoring";
import type { ChainSettings } from "./business";
import { humanizeKind, summarizeDecision } from "./decision-text";
import { shortHex } from "../format";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

const VIEW_ROLES: Role[] = ["owner", "approver", "requester", "viewer"];

export interface DecisionOptionView {
  kind?: string;
  discountBps?: number;
  payBy?: number | string;
  paid?: string;
  annualizedBps?: number;
  clears?: boolean;
  reasons?: string[];
  [key: string]: unknown;
}

export interface DecisionDetailView {
  id: string;
  businessId: string;
  kind: string;
  /** What the record is called to a person (never the stored code word) */
  kindLabel: string;
  subject: string | null;
  /** What the record is about, in words: the invoice's own number, or the setting; null if nothing readable */
  subjectLabel: string | null;
  hash: string;
  hashMatches: boolean;
  canonicalJson: string;
  at: Date;
  mode?: string;
  sentence: string;
  explanation?: string;
  rule: string;
  outcome: string;
  inputs: Record<string, unknown>;
  /** The invoice's currency ("USDC", "EURC"), so stored amounts read as money; USDC when the record isn't about an invoice */
  currency: string;
  /** The lending vault's share decimals, so its shares read as "58.1385 shares" (QA R25-6); absent when the record names no venue */
  shareDecimals?: number;
  /** Person ids in the record (`actor`) in words: "You (wallet 0x645c…4E7b)", never a raw id (QA R25-5) */
  people: Record<string, string>;
  options: DecisionOptionView[];
  humanResponses: Array<{
    id: string;
    kind: string;
    actor?: string;
    reason?: string;
    createdAt: Date;
  }>;
  txHash: string | null;
  anchor: DecisionAnchorInfo;
  /**
   * What has happened to the invoice since this record was written (plan 05zl 1.4, QA 5): a decision is history and stays true
   * as written, so the page says when it was found and points to anything newer, never presents it as the present state.
   * Null for a decision that isn't about an invoice.
   */
  since: { newerId: string | null; newerAt: Date | null; newerSentence: string | null; invoiceStatus: string | null; invoiceHref: string | null } | null;
}

/**
 * Loads a single decision record by ID, verifying its canonical hash and loading
 * human responses, related transaction, and anchor proof (Decision A9).
 */
export async function loadDecision(
  db: Database,
  client: PublicClient,
  cfg: ChainSettings,
  user: Pick<SessionUser, "id">,
  businessId: string,
  id: string,
): Promise<DecisionDetailView | null> {
  await requireMember(db, user.id, businessId, ...VIEW_ROLES);

  const [row] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.id, id), eq(decisions.businessId, businessId)))
    .limit(1);

  if (!row) return null;

  const rec = (row.record as Record<string, unknown>) ?? {};
  let hashMatches = false;
  let canonicalJson = "";
  try {
    const computed = hashRecord(rec as unknown as DecisionRecord);
    canonicalJson = computed.canonical;
    hashMatches = computed.hash.toLowerCase() === row.hash.toLowerCase();
  } catch (err) {
    console.error("Error hashing decision record:", err);
    canonicalJson = JSON.stringify(rec, null, 2);
  }

  // cash back from lending reads as that, not as a deposit, on its own page too (QA retest 18)
  let summaryRec = rec;
  if (row.kind === "deposit_confirmed" && row.txHash) {
    const [redeemed] = await db
      .select({ txHash: chainEvents.txHash })
      .from(chainEvents)
      .where(and(eq(chainEvents.txHash, row.txHash.toLowerCase() as Hex), eq(chainEvents.eventName, "LendingRedeemed")))
      .limit(1);
    if (redeemed) summaryRec = { ...rec, inputs: { ...((rec.inputs as Record<string, unknown> | undefined) ?? {}), fromLending: true } };
  }

  // Human responses linked to this recommendation (Decision A9)
  const humanDecRows = await db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.businessId, businessId),
        sql`(${decisions.record}->'inputs'->>'recommendation' = ${row.hash.toLowerCase()} or ${decisions.record}->>'recommendation' = ${row.hash.toLowerCase()})`,
      ),
    )
    .orderBy(desc(decisions.createdAt));

  const humanResponses = humanDecRows.map((hr) => {
    const hrRec = (hr.record as Record<string, unknown>) ?? {};
    return {
      id: hr.id,
      kind: hr.kind,
      actor: typeof hrRec.actor === "string" ? hrRec.actor : typeof hrRec.signer === "string" ? hrRec.signer : undefined,
      reason: typeof hrRec.reason === "string" ? hrRec.reason : undefined,
      createdAt: hr.createdAt,
    };
  });

  // Find linked transaction: either in this record or a superseding decision
  let txHash: string | null = row.txHash ?? null;
  if (!txHash) {
    const [txDec] = await db
      .select({ txHash: decisions.txHash, record: decisions.record })
      .from(decisions)
      .where(
        and(
          eq(decisions.businessId, businessId),
          sql`(${decisions.supersedes} = ${row.id} or ${decisions.record}->'inputs'->>'decisionHash' = ${row.hash.toLowerCase()} or ${decisions.record}->>'decision' = ${row.hash.toLowerCase()})`,
        ),
      )
      .limit(1);
    if (txDec) {
      txHash = txDec.txHash ?? ((txDec.record as any)?.inputs?.txHash as string) ?? null;
    }
  }

  // a record that carries its own transaction (an owner's Pay now) shows it under "What happened" too (QA R25-5)
  if (!txHash) {
    const own = (rec.inputs as { txHash?: unknown } | undefined)?.txHash ?? rec.txHash;
    if (typeof own === "string" && /^0x[0-9a-fA-F]{64}$/.test(own)) txHash = own;
  }

  // Anchor status and proof (Decision A10)
  const anchor = await anchorState(db, client, cfg, businessId, row.hash as Hex);

  let since: DecisionDetailView["since"] = null;
  let currency = "USDC";
  if (row.subject && /^0x[0-9a-fA-F]{64}$/.test(row.subject)) {
    const [newer] = await db
      .select({ id: decisions.id, createdAt: decisions.createdAt, record: decisions.record })
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, row.subject), gt(decisions.createdAt, row.createdAt)))
      .orderBy(desc(decisions.createdAt))
      .limit(1);
    const [inv] = await db
      .select({ status: invoices.status, token: invoices.token })
      .from(invoices)
      .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, row.subject.toLowerCase() as Hex)))
      .limit(1);
    if (inv?.token && inv.token.toLowerCase() === cfg.deployment.tokens.eurc.toLowerCase()) currency = "EURC";
    since = {
      newerId: newer?.id ?? null,
      newerAt: newer?.createdAt ?? null,
      // QA STW-4: say what the later record is, so two records in the same minute aren't confusing
      newerSentence: newer ? summarizeDecision(newer.record as Record<string, unknown>, { currency }).sentence : null,
      invoiceStatus: inv?.status ?? null,
      invoiceHref: inv ? `/business/inbox/${row.subject.toLowerCase()}` : null,
    };
  }

  // said in the invoice's own currency: "Paid €239.45" for an EURC invoice (QA R25-2)
  const summary = summarizeDecision(summaryRec, { currency });

  const ids = new Set<string>();
  const inputActor = (rec.inputs as { actor?: unknown } | undefined)?.actor;
  for (const a of [rec.actor, inputActor, ...humanResponses.map((h) => h.actor)]) if (typeof a === "string" && UUID.test(a)) ids.add(a);
  const people = await peopleLabels(db, businessId, user.id, [...ids]);

  // a lending record's shares are in the venue's own decimals (an ERC-4626 vault is often 18, not USDC's 6)
  let shareDecimals: number | undefined;
  const venue = (rec.inputs as { venue?: unknown } | undefined)?.venue;
  if (typeof venue === "string" && /^0x[0-9a-fA-F]{40}$/.test(venue)) {
    shareDecimals = await client.readContract({ address: getAddress(venue), abi: erc20Abi, functionName: "decimals" }).then(Number).catch(() => undefined);
  }

  const rawOptions = Array.isArray(rec.options) ? (rec.options as DecisionOptionView[]) : [];

  return {
    id: row.id,
    businessId: row.businessId,
    kind: row.kind,
    kindLabel: humanizeKind(row.kind),
    subject: row.subject,
    subjectLabel: await subjectLabelFor(db, businessId, row.subject),
    hash: row.hash,
    hashMatches,
    canonicalJson,
    at: row.createdAt,
    mode: typeof rec.mode === "string" ? rec.mode : undefined,
    sentence: summary.sentence,
    explanation: summary.explanation,
    rule: String(rec.rule ?? ""),
    outcome: String(rec.outcome ?? ""),
    inputs: (rec.inputs as Record<string, unknown>) ?? {},
    currency,
    people,
    ...(shareDecimals !== undefined ? { shareDecimals } : {}),
    options: rawOptions,
    humanResponses,
    txHash,
    anchor,
    since,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "You (wallet 0x645c…4E7b)", "Ama Owusu (owner, wallet 0xc81f…1CFb)": a person in a record, said the way the team page says them */
async function peopleLabels(db: Database, businessId: string, viewer: string, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const [row] = await db
      .select({ displayName: users.displayName, wallet: users.wallet, role: members.role })
      .from(users)
      .leftJoin(members, and(eq(members.userId, users.id), eq(members.businessId, businessId)))
      .where(eq(users.id, id))
      .limit(1);
    const wallet = row?.wallet ? `wallet ${shortHex(row.wallet)}` : "";
    if (id === viewer) out[id] = wallet ? `You (${row?.role ? `${row.role}, ` : ""}${wallet})` : "You";
    else if (row) {
      const who = row.displayName?.trim() || (row.role ? `A team ${row.role}` : "A team member");
      const extra = [row.displayName?.trim() && row.role ? row.role : "", wallet].filter(Boolean).join(", ");
      out[id] = extra ? `${who} (${extra})` : who;
    } else out[id] = "A former team member";
  }
  return out;
}

/** "settings:early_pay" → "Early pay"; an invoice fingerprint → "Invoice <number>"; a hash with no invoice row → null */
async function subjectLabelFor(db: Database, businessId: string, subject: string | null): Promise<string | null> {
  if (!subject) return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(subject)) {
    const [inv] = await db
      .select({ number: invoices.invoiceNumber })
      .from(invoices)
      .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, subject.toLowerCase() as Hex)))
      .limit(1);
    return inv?.number ? `Invoice ${inv.number}` : null;
  }
  const parts = subject.split(":");
  if (parts[0] === "vault" && parts.length > 1) return `Vault ${parts[parts.length - 1]!.replace(/[_-]+/g, " ")}`;
  return humanizeKind(parts.length > 1 ? parts.slice(1).join(" ") : subject);
}

/**
 * Lists decision records for a business with pagination.
 */
export async function listDecisions(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  opts: { limit?: number; offset?: number } = {},
) {
  await requireMember(db, user.id, businessId, ...VIEW_ROLES);
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;

  const rows = await db
    .select()
    .from(decisions)
    .where(eq(decisions.businessId, businessId))
    .orderBy(desc(decisions.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => {
    const rec = (r.record as Record<string, unknown>) ?? {};
    const s = summarizeDecision(rec);
    return {
      id: r.id,
      kind: r.kind,
      subject: r.subject,
      hash: r.hash,
      sentence: s.sentence,
      explanation: s.explanation,
      txHash: r.txHash,
      createdAt: r.createdAt,
    };
  });
}
