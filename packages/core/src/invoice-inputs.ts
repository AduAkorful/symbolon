import { and, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";

import type { Deployment, SymbolonContracts } from "@symbolon/chain";
import { decisions, earlyPayOffers, invoices, payees, screenings, type Database } from "@symbolon/db";
import { outflowsWithin, type CashFlow, type InvoiceContext } from "@symbolon/steward";

/** The same open-invoice selection used for the scheduled Steward and wallet preflight. */
export function openInvoicesForSteward(db: Database, businessId: string) {
  return db.select().from(invoices).where(and(
    eq(invoices.businessId, businessId),
    or(
      inArray(invoices.status, ["verified", "scheduled", "awaiting_approval"]),
      and(eq(invoices.status, "held"), eq(invoices.holdSource, "steward")),
    ),
  ));
}

export function knownInvoicesForSteward(db: Database, businessId: string, seal: string, fingerprint: string) {
  return db.select().from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.seal, seal), ne(invoices.fingerprint, fingerprint)));
}

type Inputs = Pick<InvoiceContext,
  "knownInvoices" | "offers" | "operatingCash" | "buffer" | "earlyPayCommitted" | "blockedSeal" | "latestScreenedAddress"
>;

export interface InvoiceInputsEnv {
  db: Database;
  contracts: SymbolonContracts;
  deployment: Deployment;
  bufferDays: number;
}

/**
 * Deterministic business inputs shared by the scheduled runner and human wallet preflight.
 * Required reads reject; cash/open-invoice/commitment snapshots are private to this pass,
 * preserving the runner's existing per-run liquidity snapshot. Each invoice loads current business controls.
 */
export async function createInvoiceInputReader(
  env: InvoiceInputsEnv,
  businessId: string,
  vault: Address,
) {
  const { db } = env;
  const [cash, open, committed] = await Promise.all([
    env.contracts.token(env.deployment.tokens.usdc).read.balanceOf([vault]),
    openInvoicesForSteward(db, businessId),
    committedToEarlyPay(db, businessId),
  ]);
  async function forInvoice(row: Pick<typeof invoices.$inferSelect, "fingerprint" | "seal">, now: bigint): Promise<Inputs> {
    const [known, offers, vendor, latestScreening] = await Promise.all([
      knownInvoicesForSteward(db, businessId, row.seal, row.fingerprint),
      db.select().from(earlyPayOffers).where(and(
        eq(earlyPayOffers.fingerprint, row.fingerprint), eq(earlyPayOffers.status, "open"),
      )),
      db.select({ status: payees.status }).from(payees).where(and(
        eq(payees.businessId, businessId), eq(payees.seal, row.seal),
      )).limit(1),
      db.select({ address: screenings.address }).from(screenings).innerJoin(decisions, and(
        eq(decisions.businessId, businessId), eq(decisions.kind, "screening_recorded"),
        sql`${decisions.record}->'inputs'->>'screeningId' = ${screenings.id}::text`,
      )).where(and(eq(screenings.businessId, businessId), eq(screenings.seal, row.seal)))
        .orderBy(desc(screenings.screenedAt)).limit(1),
    ]);
    const flows: CashFlow[] = open.filter((o) => o.fingerprint !== row.fingerprint).map((o) => ({
      at: BigInt(Math.floor(o.dueDate.getTime() / 1000)), amount: o.total - o.credited,
      direction: "out", ref: o.fingerprint,
    }));
    return {
      operatingCash: cash,
      buffer: outflowsWithin(flows, now, env.bufferDays),
      earlyPayCommitted: committed,
      knownInvoices: known.map((k) => ({
        fingerprint: k.fingerprint as Hex, seal: k.seal, invoiceNumber: k.invoiceNumber, amount: k.total,
        issuedAt: BigInt(Math.floor((k.issuedAt ?? k.receivedAt).getTime() / 1000)),
      })),
      offers: offers.filter((o) => o.signature).map((o) => ({
        discountBps: o.discountBps, validUntil: BigInt(Math.floor(o.validUntil.getTime() / 1000)), signature: o.signature as Hex,
      })),
      blockedSeal: vendor[0]?.status === "blocked",
      latestScreenedAddress: latestScreening[0]?.address as Address | undefined,
    };
  }
  return { open, forInvoice };
}

/** Preserves the runner's rolling 30-day commitment calculation while sharing it with wallet preflight. */
async function committedToEarlyPay(db: Database, businessId: string): Promise<bigint> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db.select({ record: decisions.record }).from(decisions).where(and(
    eq(decisions.businessId, businessId), eq(decisions.kind, "pay"), gte(decisions.createdAt, since),
  ));
  return rows.reduce((sum, { record }) => {
    const inputs = (record as { inputs?: { timing?: string; paid?: string } }).inputs;
    return inputs?.timing === "pay_now_discounted" && inputs.paid ? sum + BigInt(inputs.paid) : sum;
  }, 0n);
}
