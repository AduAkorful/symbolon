import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { type Address, type Hex } from "viem";

import { createSeries, releaseDue } from "@symbolon/core";
import { recurringSeries, seriesInvoices, type Database } from "@symbolon/db";
import {
  completeTotals,
  sealDomain,
  seriesDrafts,
  toInvoice,
  typedDataJson,
  type DocumentDraft,
  type SeriesSchedule,
} from "@symbolon/seal";

import { buildDocument, type ComposeContext, type ComposerDraft } from "./compose";
import { AuthError } from "./errors";
import type { AppConfig } from "./load-config";
import type { SessionUser } from "./session";
import { requireMySeal } from "./vendor";

export interface PreparedPeriod {
  period: number;
  invoiceNumber: string;
  issuedAt: number;
  dueDate: number;
  total: string;
  document: unknown;
  typedData: string;
}

export interface SeriesDisplay {
  id: string;
  seal: string;
  businessId: string | null;
  description: string | null;
  status: "active" | "cancelled";
  createdAt: string;
  totalPeriods: number;
  releasedPeriods: number;
  nextReleaseAt: string | null;
}

/**
 * Prepares all periods of a recurring series for signing (Plan 05q, Decision V14).
 */
export async function prepareSeries(
  db: Database,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  templateDraft: ComposerDraft,
  scheduleInput: {
    start: unknown;
    periods: unknown;
    every: unknown; // "monthly" | { days: number }
    dueAfterDays: unknown;
  },
) {
  const seal = await requireMySeal(db, user.id);

  const periods = Number(scheduleInput.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 60) {
    throw new AuthError(400, "A series must have between 1 and 60 periods.");
  }

  const start = Number(scheduleInput.start);
  if (!Number.isInteger(start) || start < 0) {
    throw new AuthError(400, "Start date is invalid.");
  }

  const dueAfterDays = Number(scheduleInput.dueAfterDays);
  if (!Number.isInteger(dueAfterDays) || dueAfterDays < 0 || dueAfterDays > 365) {
    throw new AuthError(400, "Due after days must be between 0 and 365.");
  }

  let every: SeriesSchedule["every"];
  if (scheduleInput.every === "monthly") {
    every = "monthly";
  } else if (
    typeof scheduleInput.every === "object" &&
    scheduleInput.every !== null &&
    "days" in scheduleInput.every
  ) {
    const days = Number((scheduleInput.every as { days: unknown }).days);
    if (!Number.isInteger(days) || days < 1) {
      throw new AuthError(400, "Interval days must be a positive integer.");
    }
    every = { days };
  } else {
    throw new AuthError(400, "Choose monthly or a fixed number of days for interval.");
  }

  const schedule: SeriesSchedule = {
    start,
    periods,
    every,
    dueAfterDays,
  };

  const ctx: ComposeContext = {
    now: new Date(start * 1000),
    chainId: cfg.chainId,
    seal: {
      address: seal.address,
      displayName: seal.displayName,
      legalName: seal.legalName,
      website: seal.website,
      payoutAddress: seal.payoutAddress,
    },
    tokens: { USDC: cfg.deployment.tokens.usdc, EURC: cfg.deployment.tokens.eurc },
    decimals: 6, // Arc USDC & EURC both have 6 decimals
    payoutDomain: 0,
  };

  const initialDoc = buildDocument(templateDraft, ctx);

  const templateDraftForSeries: DocumentDraft = {
    ...initialDoc,
    lineItems: initialDoc.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
    })),
    taxes: initialDoc.taxes.map((t) => ({
      label: t.label,
      rateBps: t.rateBps,
      amount: t.amount,
    })),
  };

  let drafts;
  try {
    drafts = seriesDrafts(templateDraftForSeries, schedule);
  } catch (err) {
    throw new AuthError(400, err instanceof Error ? err.message : "Invalid series schedule.");
  }

  const domain = sealDomain(cfg.chainId, cfg.deployment.contracts.invoiceLedger);

  const preparedList: PreparedPeriod[] = drafts.map((d, i) => {
    const doc = completeTotals(d);
    const inv = toInvoice(doc);
    const typedData = typedDataJson(domain, "Invoice", inv);
    return {
      period: i + 1,
      invoiceNumber: doc.invoiceNumber,
      issuedAt: doc.issuedAt,
      dueDate: doc.dueDate,
      total: doc.total,
      document: doc,
      typedData,
    };
  });

  return { periods: preparedList };
}

/**
 * Submits the vendor-signed series envelopes (all N periods signed) to the database.
 */
export async function submitSeries(
  db: Database,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  user: Pick<SessionUser, "id">,
  input: {
    envelopes?: unknown;
    periods?: unknown;
    signatures?: unknown;
    businessId?: unknown;
    description?: unknown;
  },
) {
  const seal = await requireMySeal(db, user.id);

  let envelopes: string[] = [];
  if (Array.isArray(input.envelopes) && input.envelopes.length > 0) {
    envelopes = input.envelopes.map((e) => {
      if (typeof e !== "string" || !e.trim()) {
        throw new AuthError(400, "All envelopes must be valid non-empty strings.");
      }
      return e.trim();
    });
  } else if (Array.isArray(input.periods) && Array.isArray(input.signatures)) {
    if (input.periods.length !== input.signatures.length || input.periods.length === 0) {
      throw new AuthError(400, "Periods and signatures counts must match and be non-empty.");
    }
    const ledger = cfg.deployment.contracts.invoiceLedger.toLowerCase();
    const sigs = input.signatures as unknown[];
    envelopes = input.periods.map((p: any, i: number) => {
      const sig = String(sigs[i]);
      if (!/^0x[0-9a-fA-F]+$/.test(sig)) {
        throw new AuthError(400, `Signature for period ${i + 1} is invalid.`);
      }
      return JSON.stringify({
        v: 1,
        chainId: cfg.chainId,
        ledger,
        document: p.document,
        signature: sig.toLowerCase(),
      });
    });
  } else {
    throw new AuthError(400, "Series requires signed envelopes or periods and signatures.");
  }

  const businessId = typeof input.businessId === "string" ? input.businessId : undefined;
  const description = typeof input.description === "string" ? input.description.trim() : undefined;

  try {
    const coreDeployment = {
      chainId: cfg.chainId,
      ledger: cfg.deployment.contracts.invoiceLedger,
    };
    const res = await createSeries(db, coreDeployment, envelopes, {
      businessId,
      description,
      expectedSeal: seal.address,
    });

    // Immediately release any period that is due right now
    await releaseDue(db, coreDeployment, new Date(), { seal: seal.address });

    return { id: res.id, periods: res.periods };
  } catch (err) {
    throw new AuthError(400, err instanceof Error ? err.message : "Failed to create series.");
  }
}

/**
 * Lists recurring series created by the current vendor.
 */
export async function listSeries(
  db: Database,
  user: Pick<SessionUser, "id">,
): Promise<SeriesDisplay[]> {
  const seal = await requireMySeal(db, user.id);

  const seriesRows = await db
    .select()
    .from(recurringSeries)
    .where(eq(recurringSeries.seal, seal.address.toLowerCase()))
    .orderBy(desc(recurringSeries.createdAt));

  const result: SeriesDisplay[] = [];

  for (const s of seriesRows) {
    const items = await db
      .select({
        period: seriesInvoices.period,
        releaseAt: seriesInvoices.releaseAt,
        releasedAt: seriesInvoices.releasedAt,
      })
      .from(seriesInvoices)
      .where(eq(seriesInvoices.seriesId, s.id));

    const totalPeriods = items.length;
    const releasedPeriods = items.filter((i) => i.releasedAt !== null).length;
    const unreleased = items
      .filter((i) => i.releasedAt === null)
      .sort((a, b) => a.releaseAt.getTime() - b.releaseAt.getTime());

    result.push({
      id: s.id,
      seal: s.seal,
      businessId: s.businessId,
      description: s.description,
      status: s.status as SeriesDisplay["status"],
      createdAt: s.createdAt.toISOString(),
      totalPeriods,
      releasedPeriods,
      nextReleaseAt: unreleased[0] ? unreleased[0].releaseAt.toISOString() : null,
    });
  }

  return result;
}

/**
 * Cancels a recurring series (preventing any unreleased periods from releasing).
 */
export async function cancelSeries(
  db: Database,
  user: Pick<SessionUser, "id">,
  seriesId: string,
) {
  const seal = await requireMySeal(db, user.id);

  const [s] = await db
    .select()
    .from(recurringSeries)
    .where(and(eq(recurringSeries.id, seriesId), eq(recurringSeries.seal, seal.address.toLowerCase())))
    .limit(1);

  if (!s) {
    throw new AuthError(404, "Series not found.");
  }

  if (s.status === "cancelled") {
    return { cancelled: true };
  }

  await db
    .update(recurringSeries)
    .set({ status: "cancelled" })
    .where(eq(recurringSeries.id, seriesId));

  return { cancelled: true };
}

/**
 * Safe helper to release due recurring invoices.
 */
export async function releaseDueSafe(
  db: Database,
  cfg: Pick<AppConfig, "chainId" | "deployment">,
  scope: { businessId?: string; seal?: string } = {},
) {
  return releaseDue(
    db,
    { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger },
    new Date(),
    scope,
  );
}
