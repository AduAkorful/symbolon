import { and, desc, eq, isNull } from "drizzle-orm";
import { getAddress, keccak256, stringToBytes, type Hex, type PublicClient } from "viem";

import { simulateCall, type Deployment, type SymbolonContracts } from "@symbolon/chain";
import { businesses, decisions, earlyPayOffers, invoices, type Database } from "@symbolon/db";
import { canonicalJson, decodeSealedInvoice, deriveInvoice } from "@symbolon/seal";
import {
  processInvoice,
  hashRecord,
  type InvoiceContext,
  type EarlyPayProgram,
  type StewardModel,
  type StewardResult,
  type StewardWallet,
} from "@symbolon/steward";

import { collectApprovals } from "./approvals.js";
import { readVaultFacts } from "./facts.js";
import { createInvoiceInputReader } from "./invoice-inputs.js";
import { counterRecommendation } from "./counter-lifecycle.js";
import { counterOffer } from "./offers.js";
import { notifyBusiness } from "./domain-notifications.js";

export interface StewardEnv {
  db: Database;
  client: PublicClient;
  contracts: SymbolonContracts;
  deployment: Deployment;
  program: EarlyPayProgram;
  /** Days of upcoming bills to keep in cash (spec §9 example: 30) */
  bufferDays: number;
  /** Current reserve yield (annualized bps) for the Early Pay hurdle; 0 when the business holds no reserve */
  reserveYieldBps: number;
  model?: StewardModel;
  wallet?: StewardWallet;
  walletFor?: (business: { id: string; vault: string; stewardWallet: string | null }) => Promise<StewardWallet | undefined>;
}

export { knownInvoicesForSteward } from "./invoice-inputs.js";

/**
 * One Steward pass over a business's open invoices. Each invoice gets a decision; a decision is stored only when it
 * differs from the last one for that invoice (so a scheduled invoice doesn't write a record every run).
 */
export async function runSteward(env: StewardEnv, businessId: string): Promise<StewardResult[]> {
  const { db } = env;
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!biz?.vault) throw new Error(`business ${businessId} has no Vault yet`);
  const vault = getAddress(biz.vault);
  const mode = biz.stewardMode as "shadow" | "assist" | "auto";
  const wallet = (env.walletFor ? await env.walletFor({ id: businessId, vault, stewardWallet: biz.stewardWallet }) : undefined) ?? env.wallet;

  const inputs = await createInvoiceInputReader(env, businessId, vault);
  const open = inputs.open;
  const results: StewardResult[] = [];

  for (const row of open) {
    const sealed = decodeSealedInvoice(row.envelope);
    const invoice = deriveInvoice(sealed.document);
    const fp = row.fingerprint as Hex;
    const facts = await readVaultFacts(env.contracts, env.client, vault, invoice, fp);
    const remaining = await env.contracts.ledger.read.remaining([fp]);
    const seen = (await env.contracts.ledger.read.status([fp])).seen;
    const now = new Date(Number(facts.now) * 1000);
    const businessInputs = await inputs.forInvoice(row, facts.now);
    const budgetId = facts.purchaseOrder?.budget ?? facts.payee?.terms.budget ?? (`0x${"00".repeat(32)}` as Hex);
    const credit = seen ? remaining : invoice.amount;
    const held = await collectApprovals(db, env.contracts, vault, businessId, fp, credit, budgetId, now);

    const context: InvoiceContext = {
        business: { id: businessId, vault, mode, program: env.program },
        deployment: { chainId: env.deployment.chainId, ledger: env.deployment.contracts.invoiceLedger },
        envelope: row.envelope,
        facts,
        ledgerRemaining: seen ? remaining : undefined,
        ...businessInputs,
        reserveYieldBps: env.reserveYieldBps,
        approvalHeld: held.level,
        approvals: held.approvals,
      };
    const result = await processInvoice(
      context,
      {
        ...(env.model ? { model: env.model } : {}),
        simulate: async (call) => {
          if (!wallet) throw new Error("no Steward wallet");
          return simulateCall(env.client, call, wallet.address);
        },
        ...(wallet ? { send: (call) => wallet.send(call) } : {}),
      },
    );
    await storeDecision(db, businessId, result);
    const counter = counterRecommendation(context, result);
    if (counter) {
      const previous = await db.select().from(earlyPayOffers).where(and(eq(earlyPayOffers.fingerprint, fp), isNull(earlyPayOffers.signature)));
      if (!previous.length) {
        if (mode === "auto") {
          try { await counterOffer(db, { fingerprint: fp, discountBps: counter.discountBps, validUntil: new Date(Number(counter.validUntil) * 1000) }); }
          catch (error) { if (!(error instanceof Error && error.message === "already countered once")) throw error; }
        }
        const record = { ...result.record, kind: mode === "auto" ? "counter" : "counter_recommended",
          inputs: { discountBps: counter.discountBps, validUntil: counter.validUntil.toString() },
          rule: "one unsigned counter at the smallest discount clearing the owner's limits", outcome: mode === "auto" ? "countered" : "counter recommended" };
        const existing = await db.select({ record: decisions.record }).from(decisions).where(and(eq(decisions.businessId, businessId), eq(decisions.subject, fp), eq(decisions.kind, record.kind)));
        if (!existing.some((d) => JSON.stringify(d.record.inputs) === JSON.stringify(record.inputs))) {
          await db.insert(decisions).values({ businessId, subject: fp, kind: record.kind, record: record as unknown as Record<string, unknown>, hash: hashRecord(record).hash }).onConflictDoNothing();
        }
      }
    }
    const status = statusFor(result, mode, row.status);
    if (status && status !== row.status) {
      const holdSource = status === "held" ? "steward" : null;
      await db.update(invoices).set({ status, holdSource, holdKind: null }).where(eq(invoices.fingerprint, row.fingerprint));
    } else if (status === "held" && row.holdSource !== "steward") {
      await db.update(invoices).set({ holdSource: "steward" }).where(eq(invoices.fingerprint, row.fingerprint));
    }
    if (status === "awaiting_approval") await notifyBusiness(db, businessId, { kind: "approval_needed", subject: fp,
      body: { invoiceNumber: row.invoiceNumber }, dedupeKey: `approval:${fp}` });
    results.push(result);
  }
  return results;
}

function statusFor(r: StewardResult, mode: string, currentStatus?: string): (typeof invoices.$inferSelect)["status"] | undefined {
  switch (r.outcome) {
    case "rejected":
      return "rejected";
    case "held":
    case "refused":
      return "held";
    case "scheduled":
      return "scheduled";
    case "awaiting_approval":
      return "awaiting_approval";
    case "proposed":
      if (mode === "assist") return "awaiting_approval";
      if (currentStatus === "held") return "verified";
      return undefined;
    default:
      return undefined; // paid / already_settled: chain sync sets the status from the ledger
  }
}

/** Appends the decision unless the last one for this invoice says the same thing; a sent tx gets its own row */
async function storeDecision(db: Database, businessId: string, r: StewardResult): Promise<void> {
  const subject = r.record.subject ?? null;
  if (subject) {
    const [last] = await db
      .select()
      .from(decisions)
      .where(and(eq(decisions.businessId, businessId), eq(decisions.subject, subject)))
      .orderBy(desc(decisions.createdAt))
      .limit(1);
    const lastRecord = last?.record as { kind?: string; outcome?: string; rule?: string } | undefined;
    if (!r.txHash && lastRecord && lastRecord.kind === r.record.kind && lastRecord.outcome === r.record.outcome && lastRecord.rule === r.record.rule) return;
  }
  await db
    .insert(decisions)
    .values({ businessId, kind: r.record.kind, subject, record: r.record as unknown as Record<string, unknown>, hash: r.hash })
    .onConflictDoNothing();
  if (r.txHash) {
    const record = { version: 1, kind: "tx", decision: r.hash, txHash: r.txHash };
    const [prev] = await db.select({ id: decisions.id }).from(decisions).where(eq(decisions.hash, r.hash));
    await db.insert(decisions).values({
      businessId,
      kind: "tx",
      subject,
      record,
      hash: keccak256(stringToBytes(canonicalJson(record))),
      txHash: r.txHash.toLowerCase(),
      ...(prev ? { supersedes: prev.id } : {}),
    });
  }
}
