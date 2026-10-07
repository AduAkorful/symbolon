import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { formatAmount } from "@symbolon/seal";
import { resolveTokenSymbol } from "@symbolon/core";
import { formatDateTime, showMoney } from "../format";
import {
  businesses,
  chainEvents,
  decisions,
  invoices,
  members,
  seals,
  users,
  type Database,
} from "@symbolon/db";
import { getAddress, type Address, type PublicClient } from "viem";
import { requireMember } from "./access";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

export interface ActivityActor {
  kind: "steward" | "person" | "vault" | "vendor" | "system";
  label: string;
  wallet?: string;
}

export interface ActivityItem {
  id: string;
  at: string;
  actor: ActivityActor;
  what: string;
  vendor?: string;
  budget?: string;
  href?: string;
  tx?: string;
  tone?: "seal" | "red";
  source: "decision" | "chain_event" | "invoice";
}

export interface ActivityFilters {
  who?: string;
  vendor?: string;
  budget?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface ActivityFeed {
  items: ActivityItem[];
  nextCursor?: string;
  whoOptions: string[];
  vendorOptions: string[];
  budgetOptions: string[];
}

/**
 * An amount for an event line, "$1,985.00 ". The event doesn't always say which token it moved, so the caller passes the symbol
 * it resolved (from the event's own token or the invoice's); with none, no amount is written rather than a guessed currency.
 */
function eventAmount(raw: unknown, symbol: string | undefined): string {
  if (!raw || !symbol || symbol === "UNKNOWN") return "";
  return `${showMoney(formatAmount(BigInt(String(raw)), 6), symbol)} `;
}

function invoiceAmountText(inv: { total: bigint; token: string; chainId: number }): string {
  const symbol = resolveTokenSymbol(inv.token, inv.chainId);
  return symbol === "UNKNOWN" ? "currency unavailable" : showMoney(formatAmount(inv.total, 6), symbol);
}

/** Pure function describing Vault and Ledger chain events per K12; `symbol` is the token the event's amount is in, when known */
export function describeEvent(eventName: string, args: Record<string, unknown>, txHash?: string, symbol?: string): { what: string; tone?: "seal" | "red" } {
  switch (eventName) {
    case "Paid": {
      return { what: `Paid ${eventAmount(args.paid, symbol)}for invoice ${String(args.fingerprint || "").slice(0, 10)}…`, tone: "seal" };
    }
    case "Withdrawn": {
      return { what: `Withdrew ${eventAmount(args.amount, symbol)}to ${String(args.to || "").slice(0, 10)}…` };
    }
    case "PolicySet":
      return { what: "Updated Vault policy onchain" };
    case "ChangeQueued":
      return { what: `Queued loosening change onchain (effective ${args.eta ? formatDateTime(new Date(Number(args.eta) * 1000)) : "later"})` };
    case "ChangeCancelled":
      return { what: "Cancelled queued change onchain" };
    case "PayeeAdded":
      return { what: `Added payee ${String(args.seal || "").slice(0, 10)}… onchain` };
    case "PayoutChangeInitiated":
      return { what: `Vendor payout change initiated; cooldown started`, tone: "red" };
    case "PayoutChangeConfirmed":
      return { what: `Confirmed payout address change for ${String(args.seal || "").slice(0, 10)}…` };
    case "PurchaseOrderOpened":
      return { what: `Opened purchase order onchain` };
    case "PurchaseOrderClosed":
      return { what: `Closed purchase order onchain` };
    case "DeliveryConfirmed":
      return { what: `Confirmed delivery onchain for invoice ${String(args.fingerprint || "").slice(0, 10)}…`, tone: "seal" };
    case "DeliveryRejected":
      return { what: `Rejected delivery onchain for invoice ${String(args.fingerprint || "").slice(0, 10)}…`, tone: "red" };
    case "Paused":
      return { what: "Paused Vault outgoing payments", tone: "red" };
    case "Unpaused":
      return { what: "Resumed Vault outgoing payments", tone: "seal" };
    case "StewardSet":
      return { what: `Updated Steward wallet to ${String(args.steward || "").slice(0, 10)}…` };
    case "DecisionsAnchored":
      return { what: `Anchored decisions Merkle root onchain (${args.count ?? ""} decisions)` };
    case "ScreeningSet":
      return { what: `Recorded compliance screening onchain for ${String(args.seal || "").slice(0, 10)}…` };
    case "ReserveSubscribed":
      return { what: `Moved idle cash into USYC reserve` };
    case "ReserveRedeemed":
      return { what: `Redeemed cash from USYC reserve` };
    case "Settled": {
      return { what: `Ledger settled payment of ${eventAmount(args.paid, symbol)}for invoice ${String(args.fingerprint || "").slice(0, 10)}…`, tone: "seal" };
    }
    case "Cancelled":
      return { what: `Ledger cancelled invoice ${String(args.fingerprint || "").slice(0, 10)}…`, tone: "red" };
    case "CreditNoteApplied":
      return { what: `Applied credit note on ledger for invoice ${String(args.fingerprint || "").slice(0, 10)}…` };
    default:
      return { what: `Recorded onchain: ${eventName}` };
  }
}

/** Pure function describing Decisions per K12 */
export function describeDecision(d: typeof decisions.$inferSelect): { what: string; tone?: "seal" | "red" } {
  const subjectShort = d.subject ? `${d.subject.slice(0, 10)}…` : "";
  const rec = d.record as Record<string, unknown> | null;
  const rule = rec?.rule ? String(rec.rule) : "";

  switch (d.kind) {
    case "pay":
      return { what: `Steward approved payment for invoice ${subjectShort}`, tone: "seal" };
    case "schedule":
      return { what: `Steward scheduled payment for invoice ${subjectShort} on due date` };
    case "hold":
      return { what: `Steward held invoice ${subjectShort}${rule ? `: ${rule}` : ""}`, tone: "red" };
    case "reject":
    case "refusal":
      return { what: `Steward refused invoice ${subjectShort}${rule ? `: ${rule}` : ""}`, tone: "red" };
    case "approval_signed":
      return { what: `Member signed approval for invoice ${subjectShort}`, tone: "seal" };
    case "pay_now":
      return { what: `Member paid invoice ${subjectShort} directly from wallet`, tone: "seal" };
    case "payout_change_confirmed":
      return { what: `Confirmed payout change for vendor ${subjectShort}` };
    case "screening_recorded":
      return { what: `Compliance screening recorded onchain for ${subjectShort}` };
    case "export_created":
      return { what: `Exported ${rec?.format ?? "accounting"} records (${rec?.rowCount ?? ""} entries)` };
    case "reserve_sweep":
    case "reserve_subscribe":
      return { what: "Moved idle cash into the USYC reserve", tone: "seal" };
    case "reserve_redeem":
      return { what: "Redeemed reserve cash for upcoming payment buffer" };
    case "early_pay_offered":
      return { what: `Vendor submitted early pay cash-now offer for ${subjectShort}` };
    default:
      return { what: `Decision: ${d.kind}${rec?.outcome ? ` (${rec.outcome})` : ""}` };
  }
}

/** Lazy backfill of block times for unpopulated chain_events (K9) */
async function backfillBlockTimes(db: Database, client: PublicClient, vaultAddress: string) {
  try {
    const unbacked = await db
      .select({ blockNumber: chainEvents.blockNumber })
      .from(chainEvents)
      .where(and(eq(chainEvents.address, vaultAddress.toLowerCase()), isNull(chainEvents.blockTime)))
      .limit(20);

    const distinct = [...new Set(unbacked.map((u) => u.blockNumber))];
    if (distinct.length === 0) return;

    await Promise.all(
      distinct.map(async (bn) => {
        try {
          const block = await client.getBlock({ blockNumber: bn });
          const blockTime = new Date(Number(block.timestamp) * 1000);
          await db
            .update(chainEvents)
            .set({ blockTime })
            .where(eq(chainEvents.blockNumber, bn));
        } catch {
          // ignore transient rpc errors
        }
      }),
    );
  } catch {
    // ignore
  }
}

/**
 * Loads the normalised business activity feed assembled from decisions, Vault events,
 * ledger events, and invoices received (spec §7.7, K10-K13).
 */
export async function loadActivity(
  db: Database,
  client: PublicClient | undefined,
  user: Pick<SessionUser, "id">,
  businessId: string,
  filters: ActivityFilters = {},
): Promise<ActivityFeed> {
  await requireMember(db, user.id, businessId);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) throw new AuthError(404, "Business not found");

  const vault = business.vault?.toLowerCase() ?? "";

  // Perform bounded lazy backfill of block times if client is available
  if (client && vault) {
    await backfillBlockTimes(db, client, vault);
  }

  // Load team members and users for actor resolution (K11)
  const memberRows = await db
    .select({
      userId: members.userId,
      role: members.role,
      email: users.email,
      wallet: users.wallet,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.businessId, businessId));

  const memberByUserId = new Map(memberRows.map((m) => [m.userId, m]));
  const memberByWallet = new Map(
    memberRows
      .filter((m) => m.wallet)
      .map((m) => [m.wallet!.toLowerCase(), m]),
  );

  const stewardWallet = business.stewardWallet?.toLowerCase();

  // Load seals for vendor resolution
  const sealRows = await db.select().from(seals);
  const sealMap = new Map(sealRows.map((s) => [s.address.toLowerCase(), s.displayName || s.handle || s.address]));

  // Invoices for this business
  const bizInvoices = await db.select().from(invoices).where(eq(invoices.businessId, businessId));
  const invoiceByFp = new Map(bizInvoices.map((inv) => [inv.fingerprint.toLowerCase(), inv]));
  const invoiceBySeal = new Map(bizInvoices.map((inv) => [inv.seal.toLowerCase(), inv]));

  function resolveActorForEvent(callerAddr?: string): ActivityActor {
    if (!callerAddr) return { kind: "system", label: "Chain" };
    const lower = callerAddr.toLowerCase();
    if (stewardWallet && lower === stewardWallet) {
      return { kind: "steward", label: "Steward", wallet: callerAddr };
    }
    if (vault && lower === vault) {
      return { kind: "vault", label: "Vault", wallet: callerAddr };
    }
    const mem = memberByWallet.get(lower);
    if (mem) {
      return { kind: "person", label: mem.email || `${lower.slice(0, 6)}…${lower.slice(-4)}`, wallet: callerAddr };
    }
    const vendorName = sealMap.get(lower);
    if (vendorName) {
      return { kind: "vendor", label: vendorName, wallet: callerAddr };
    }
    return { kind: "person", label: `${lower.slice(0, 6)}…${lower.slice(-4)}`, wallet: callerAddr };
  }

  function resolveActorForDecision(d: typeof decisions.$inferSelect): ActivityActor {
    const rec = d.record as Record<string, unknown> | null;
    const recInputs = rec?.inputs as Record<string, unknown> | null;
    const actorId = (recInputs as { actor?: string } | null)?.actor;
    if (actorId) {
      const mem = memberByUserId.get(actorId);
      if (mem) {
        return { kind: "person", label: mem.email || mem.wallet || "Member" };
      }
    }
    const mode = (rec as { mode?: string } | null)?.mode;
    if (mode === "shadow" || mode === "assist" || mode === "auto" || d.kind === "pay" || d.kind === "schedule" || d.kind === "hold" || d.kind === "refusal") {
      return { kind: "steward", label: "Steward", wallet: stewardWallet ?? undefined };
    }
    return { kind: "system", label: "Symbolon" };
  }

  const items: ActivityItem[] = [];

  // 1. Decisions
  const decRows = await db
    .select()
    .from(decisions)
    .where(eq(decisions.businessId, businessId))
    .orderBy(desc(decisions.createdAt))
    .limit(100);

  for (const d of decRows) {
    const desc = describeDecision(d);
    const actor = resolveActorForDecision(d);
    const rec = d.record as Record<string, unknown> | null;
    const inputs = rec?.inputs as Record<string, unknown> | null;
    const vendor = inputs?.vendor ? String(inputs.vendor) : undefined;
    const budget = inputs?.budget ? String(inputs.budget) : undefined;

    items.push({
      id: `dec-${d.id}`,
      at: d.createdAt.toISOString(),
      actor,
      what: desc.what,
      vendor,
      budget,
      href: `/business/decisions/${d.id}`,
      tx: d.txHash ?? undefined,
      tone: desc.tone,
      source: "decision",
    });
  }

  // 2. Vault Events
  if (vault) {
    const vEvents = await db
      .select()
      .from(chainEvents)
      .where(eq(chainEvents.address, vault))
      .orderBy(desc(chainEvents.blockNumber), desc(chainEvents.logIndex))
      .limit(100);

    for (const e of vEvents) {
      const args = e.args as Record<string, unknown>;
      const inv0 = args.fingerprint ? invoiceByFp.get(String(args.fingerprint).toLowerCase()) : undefined;
      const tokenOf = args.token ? String(args.token) : inv0?.token;
      const desc = describeEvent(e.eventName, args, e.txHash, tokenOf ? resolveTokenSymbol(tokenOf, business.chainId) : undefined);
      const caller = String(args.caller || args.sender || args.by || args.from || "");
      const actor = resolveActorForEvent(caller);
      const fp = args.fingerprint ? String(args.fingerprint).toLowerCase() : undefined;
      const inv = fp ? invoiceByFp.get(fp) : undefined;
      const sealAddr = args.seal ? String(args.seal).toLowerCase() : undefined;
      const vendor = inv ? (sealMap.get(inv.seal.toLowerCase()) || inv.seal) : sealAddr ? sealMap.get(sealAddr) : undefined;

      items.push({
        id: `vev-${e.txHash}-${e.logIndex}`,
        at: e.blockTime ? e.blockTime.toISOString() : e.createdAt.toISOString(),
        actor,
        what: desc.what,
        vendor,
        tx: e.txHash,
        tone: desc.tone,
        source: "chain_event",
      });
    }
  }

  // 3. Ledger Events for business invoices
  if (bizInvoices.length > 0) {
    const fps = bizInvoices.map((i) => i.fingerprint.toLowerCase());
    const ledgerEvents = await db
      .select()
      .from(chainEvents)
      .where(inArray(chainEvents.eventName, ["Settled", "Cancelled", "CreditNoteApplied"]))
      .orderBy(desc(chainEvents.blockNumber), desc(chainEvents.logIndex))
      .limit(100);

    for (const le of ledgerEvents) {
      const args = le.args as Record<string, unknown>;
      const fp = args.fingerprint ? String(args.fingerprint).toLowerCase() : "";
      if (fps.includes(fp)) {
        const inv = invoiceByFp.get(fp);
        const ledgerToken = args.token ? String(args.token) : inv?.token;
        const desc = describeEvent(le.eventName, args, le.txHash, ledgerToken ? resolveTokenSymbol(ledgerToken, business.chainId) : undefined);
        const vendor = inv ? (sealMap.get(inv.seal.toLowerCase()) || inv.seal) : undefined;
        items.push({
          id: `lev-${le.txHash}-${le.logIndex}`,
          at: le.blockTime ? le.blockTime.toISOString() : le.createdAt.toISOString(),
          actor: { kind: "vault", label: "Ledger" },
          what: desc.what,
          vendor,
          tx: le.txHash,
          tone: desc.tone,
          source: "chain_event",
        });
      }
    }
  }

  // 4. Invoices received
  for (const inv of bizInvoices.slice(0, 50)) {
    const vendorName = sealMap.get(inv.seal.toLowerCase()) || inv.seal;
    items.push({
      id: `inv-${inv.fingerprint}`,
      at: inv.receivedAt.toISOString(),
      actor: { kind: "vendor", label: vendorName, wallet: inv.seal },
      what: `Received invoice ${inv.invoiceNumber} (${invoiceAmountText(inv)})`,
      vendor: vendorName,
      href: `/business/inbox/${inv.fingerprint}`,
      source: "invoice",
    });
  }

  // Filter options sets
  const whoOptions = ["All", "Steward", "Vault", ...new Set(memberRows.map((m) => m.email || m.wallet || "Member"))];
  const vendorOptions = ["All vendors", ...new Set(items.flatMap((i) => (i.vendor ? [i.vendor] : [])))];
  const budgetOptions = ["All budgets", ...new Set(items.flatMap((i) => (i.budget ? [i.budget] : [])))];

  // Apply filters
  let filtered = items;

  if (filters.who && filters.who !== "All") {
    filtered = filtered.filter((i) => i.actor.label.toLowerCase() === filters.who!.toLowerCase());
  }

  if (filters.vendor && filters.vendor !== "All vendors") {
    filtered = filtered.filter((i) => i.vendor?.toLowerCase() === filters.vendor!.toLowerCase());
  }

  if (filters.budget && filters.budget !== "All budgets") {
    filtered = filtered.filter((i) => i.budget?.toLowerCase() === filters.budget!.toLowerCase());
  }

  // Sort strictly by chain / event time desc, then id
  filtered.sort((a, b) => {
    const timeA = new Date(a.at).getTime();
    const timeB = new Date(b.at).getTime();
    if (timeA !== timeB) return timeB - timeA;
    return b.id.localeCompare(a.id);
  });

  const limit = filters.limit ?? 50;
  const pageItems = filtered.slice(0, limit);
  const nextCursor = filtered.length > limit ? filtered[limit]?.id : undefined;

  return {
    items: pageItems,
    nextCursor,
    whoOptions,
    vendorOptions,
    budgetOptions,
  };
}
