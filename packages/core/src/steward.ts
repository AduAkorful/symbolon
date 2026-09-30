import { and, desc, eq, gte, inArray, ne, or } from "drizzle-orm";
import { getAddress, keccak256, stringToBytes, type Hex, type PublicClient } from "viem";

import { simulateCall, type Deployment, type SymbolonContracts } from "@symbolon/chain";
import { businesses, decisions, earlyPayOffers, invoices, payees, type Database } from "@symbolon/db";
import { canonicalJson, decodeSealedInvoice, deriveInvoice } from "@symbolon/seal";
import {
  outflowsWithin,
  processInvoice,
  type CashFlow,
  type EarlyPayProgram,
  type StewardModel,
  type StewardResult,
  type StewardWallet,
} from "@symbolon/steward";

import { collectApprovals } from "./approvals.js";
import { readVaultFacts } from "./facts.js";

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

const OPEN = ["verified", "scheduled", "awaiting_approval"] as const;
const DAY_MS = 86_400_000;

export function knownInvoicesForSteward(db: Database, businessId: string, seal: string, fingerprint: string) {
  return db.select().from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.seal, seal), ne(invoices.fingerprint, fingerprint)));
}

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

  const open = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        or(
          inArray(invoices.status, [...OPEN]),
          and(eq(invoices.status, "held"), eq(invoices.holdSource, "steward")),
        ),
      ),
    );
  const cash = await env.contracts.token(env.deployment.tokens.usdc).read.balanceOf([vault]);
  const earlyPayCommitted = await committedToEarlyPay(db, businessId);
  const results: StewardResult[] = [];

  for (const row of open) {
    const sealed = decodeSealedInvoice(row.envelope);
    const invoice = deriveInvoice(sealed.document);
    const fp = row.fingerprint as Hex;
    const facts = await readVaultFacts(env.contracts, env.client, vault, invoice, fp);
    const remaining = await env.contracts.ledger.read.remaining([fp]);
    const seen = (await env.contracts.ledger.read.status([fp])).seen;
    const now = new Date(Number(facts.now) * 1000);
    const [vendor] = await db.select({ status: payees.status }).from(payees)
      .where(and(eq(payees.businessId, businessId), eq(payees.seal, row.seal))).limit(1);

    const others = open.filter((o) => o.fingerprint !== row.fingerprint);
    const flows: CashFlow[] = others.map((o) => ({
      at: BigInt(Math.floor(o.dueDate.getTime() / 1000)),
      amount: o.total - o.credited,
      direction: "out",
      ref: o.fingerprint,
    }));
    const known = await knownInvoicesForSteward(db, businessId, row.seal, row.fingerprint);
    const offers = await db
      .select()
      .from(earlyPayOffers)
      .where(and(eq(earlyPayOffers.fingerprint, fp), eq(earlyPayOffers.status, "open")));
    const budgetId = facts.purchaseOrder?.budget ?? facts.payee?.terms.budget ?? (`0x${"00".repeat(32)}` as Hex);
    const credit = seen ? remaining : invoice.amount;
    const held = await collectApprovals(db, env.contracts, vault, businessId, fp, credit, budgetId, now);

    const result = await processInvoice(
      {
        business: { id: businessId, vault, mode, program: env.program },
        deployment: { chainId: env.deployment.chainId, ledger: env.deployment.contracts.invoiceLedger },
        envelope: row.envelope,
        facts,
        ledgerRemaining: seen ? remaining : undefined,
        knownInvoices: known.map((k) => ({
          fingerprint: k.fingerprint as Hex,
          seal: k.seal,
          invoiceNumber: k.invoiceNumber,
          amount: k.total,
          issuedAt: BigInt(Math.floor((k.issuedAt ?? k.receivedAt).getTime() / 1000)),
        })),
        offers: offers
          .filter((o) => o.signature)
          .map((o) => ({ discountBps: o.discountBps, validUntil: BigInt(Math.floor(o.validUntil.getTime() / 1000)), signature: o.signature as Hex })),
        reserveYieldBps: env.reserveYieldBps,
        operatingCash: cash,
        buffer: outflowsWithin(flows, facts.now, env.bufferDays),
        earlyPayCommitted,
        approvalHeld: held.level,
        approvals: held.approvals,
        blockedSeal: vendor?.status === "blocked",
      },
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
    const status = statusFor(result, mode, row.status);
    if (status && status !== row.status) {
      const holdSource = status === "held" ? "steward" : null;
      await db.update(invoices).set({ status, holdSource }).where(eq(invoices.fingerprint, row.fingerprint));
    } else if (status === "held" && row.holdSource !== "steward") {
      await db.update(invoices).set({ holdSource: "steward" }).where(eq(invoices.fingerprint, row.fingerprint));
    }
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

/** Early-pay cash committed by paid decisions over the last 30 days */
async function committedToEarlyPay(db: Database, businessId: string): Promise<bigint> {
  const since = new Date(Date.now() - 30 * DAY_MS);
  const rows = await db
    .select({ record: decisions.record })
    .from(decisions)
    .where(and(eq(decisions.businessId, businessId), eq(decisions.kind, "pay"), gte(decisions.createdAt, since)));
  return rows.reduce((sum, { record }) => {
    const inputs = (record as { inputs?: { timing?: string; paid?: string } }).inputs;
    return inputs?.timing === "pay_now_discounted" && inputs.paid ? sum + BigInt(inputs.paid) : sum;
  }, 0n);
}
