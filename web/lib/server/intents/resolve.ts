import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import { invoices, payees, seals } from "@symbolon/db";
import type { IntentContext } from "./types";

export interface VendorMatch {
  seal: string;
  name: string;
  handle: string;
  status: string;
  verifiedAt: Date | null;
  verificationMethod: string | null;
}

/**
 * The business's vendors (payees) that a person's words point at: a Seal address, else a name or handle, case-insensitive:
 * an exact match alone if there is one, otherwise every vendor whose name contains the words. Read-only.
 */
export async function resolveVendors(ctx: IntentContext, text: string): Promise<VendorMatch[]> {
  const needle = text.normalize("NFC").trim().toLowerCase();
  if (!needle) return [];
  const rows = await ctx.db
    .select({
      seal: payees.seal,
      status: payees.status,
      verifiedAt: payees.verifiedAt,
      verificationMethod: payees.verificationMethod,
      displayName: seals.displayName,
      legalName: seals.legalName,
      handle: seals.handle,
    })
    .from(payees)
    .leftJoin(seals, eq(seals.address, payees.seal))
    .where(eq(payees.businessId, ctx.businessId));

  let asAddress: string | null = null;
  try {
    asAddress = getAddress(text.trim()).toLowerCase();
  } catch {
    // not an address; match on names
  }
  const view = (r: (typeof rows)[number]): VendorMatch => ({
    seal: r.seal,
    name: r.displayName ?? r.seal,
    handle: r.handle ?? "",
    status: r.status,
    verifiedAt: r.verifiedAt,
    verificationMethod: r.verificationMethod,
  });
  if (asAddress) return rows.filter((r) => r.seal.toLowerCase() === asAddress).map(view);

  // An exact name wins. Otherwise every vendor whose name starts with or contains the words counts, so an ambiguous
  // "Ana" returns both "Studio Ana" and "Anastasia Ltd" and the caller asks which, rather than guessing one.
  const names = (r: (typeof rows)[number]) => [r.displayName, r.legalName, r.handle].filter((n): n is string => Boolean(n)).map((n) => n.toLowerCase());
  const exact = rows.filter((r) => names(r).some((n) => n === needle));
  if (exact.length > 0) return exact.map(view);
  const partial = rows.filter((r) => names(r).some((n) => n.includes(needle)));
  if (partial.length > 0) return partial.map(view);
  return [];
}

/** The latest invoice fingerprints for one vendor at this business, newest first */
export async function latestInvoicesFor(ctx: IntentContext, seal: string, limit = 3) {
  return ctx.db
    .select({ fingerprint: invoices.fingerprint, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(and(eq(invoices.businessId, ctx.businessId), sql`lower(${invoices.seal}) = ${seal.toLowerCase()}`))
    .orderBy(desc(invoices.receivedAt))
    .limit(limit);
}
