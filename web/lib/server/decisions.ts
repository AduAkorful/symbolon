import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getAddress, type Hex, type PublicClient } from "viem";

import { businesses, decisions, invoices, type Database } from "@symbolon/db";
import { hashRecord, type DecisionRecord } from "@symbolon/steward";

import { requireMember, type Role } from "./access";
import { anchorState, type DecisionAnchorInfo } from "./anchoring";
import type { ChainSettings } from "./business";
import { humanizeKind, summarizeDecision } from "./decision-text";
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
  since: { newerId: string | null; newerAt: Date | null; invoiceStatus: string | null; invoiceHref: string | null } | null;
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

  const summary = summarizeDecision(rec);

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

  // Anchor status and proof (Decision A10)
  const anchor = await anchorState(db, client, cfg, businessId, row.hash as Hex);

  let since: DecisionDetailView["since"] = null;
  if (row.subject && /^0x[0-9a-fA-F]{64}$/.test(row.subject)) {
    const [newer] = await db
      .select({ id: decisions.id, createdAt: decisions.createdAt })
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, row.subject), gt(decisions.createdAt, row.createdAt)))
      .orderBy(desc(decisions.createdAt))
      .limit(1);
    const [inv] = await db
      .select({ status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.businessId, businessId), eq(invoices.fingerprint, row.subject.toLowerCase() as Hex)))
      .limit(1);
    since = {
      newerId: newer?.id ?? null,
      newerAt: newer?.createdAt ?? null,
      invoiceStatus: inv?.status ?? null,
      invoiceHref: inv ? `/business/inbox/${row.subject.toLowerCase()}` : null,
    };
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
    options: rawOptions,
    humanResponses,
    txHash,
    anchor,
    since,
  };
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
