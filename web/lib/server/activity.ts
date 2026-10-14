import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { formatAmount } from "@symbolon/seal";
import { resolveTokenSymbol, syncVault } from "@symbolon/core";
import type { Deployment } from "@symbolon/chain";
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
import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import { requireMember } from "./access";
import { ensureVaultBlock } from "./business";
import { isPreparedPayment } from "./prepared-payment";
import { backfillDeposits } from "./deposit-backfill";
import { summarizeDecision } from "./decision-text";
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
    case "NativeReceived": {
      // sent as Arc's native coin, which is USDC in 18 decimals (the token's own amounts are 6)
      const value = args.value === undefined ? null : BigInt(String(args.value));
      return { what: value === null ? "Received USDC from a wallet" : `Received ${showMoney(formatAmount(value, 18), "USDC")} from ${String(args.from || "a wallet")}`, tone: "seal" };
    }
    case "ReserveSubscribed":
      return { what: `Moved idle cash into USYC reserve` };
    case "ReserveRedeemed":
      return { what: `Redeemed cash from USYC reserve` };
    case "LendingPolicySet":
      return { what: "Updated the lending reserve policy" };
    case "LendingDeposited":
      return { what: args.assets === undefined ? "Moved cash into the lending vault" : `Moved ${eventAmount(args.assets, "USDC")}into the lending vault` };
    case "LendingRedeemed":
      return { what: args.assets === undefined ? "Took cash out of the lending vault" : `Took ${eventAmount(args.assets, "USDC")}out of the lending vault` };
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

/**
 * Pure function describing Decisions per K12. `ref` turns a decision's subject into what a person recognises (an invoice number and
 * its vendor, a vendor's name); without one, or when it knows nothing of the subject, the start of the hash is shown, never a guess.
 */
export function describeDecision(
  d: typeof decisions.$inferSelect,
  ref?: (subject: string) => string | undefined,
): { what: string; tone?: "seal" | "red" } {
  const subjectShort = d.subject ? (ref?.(d.subject) ?? `${d.subject.slice(0, 10)}…`) : "";
  const rec = d.record as Record<string, unknown> | null;
  const rule = rec?.rule ? String(rec.rule) : "";

  switch (d.kind) {
    case "pay":
      // a payment a person chose, from the invoice or Approvals, is theirs; the Steward's own wording is for what it decided
      if (rule.startsWith("payment confirmed onchain by wallet")) {
        return { what: `Invoice ${subjectShort} paid from a member's wallet`, tone: "seal" };
      }
      // written when Pay now is opened and the Vault has checked the payment, before anything is sent (QA retest 4)
      if (rule.startsWith("a person chose to pay now")) {
        return { what: `Payment of invoice ${subjectShort} prepared from a member's wallet` };
      }
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
    {
      // stored under `inputs` (plan 05zj E, SYM-24)
      const inputs = (rec?.inputs ?? {}) as { format?: unknown; rowCount?: unknown };
      const format = inputs.format === "beancount" ? "Beancount" : "CSV";
      return { what: typeof inputs.rowCount === "number" ? `Exported ${format} accounting records (${inputs.rowCount} ${inputs.rowCount === 1 ? "entry" : "entries"})` : `Exported ${format} accounting records` };
    }
    case "reserve_sweep":
    case "reserve_subscribe":
      return { what: "Moved idle cash into the USYC reserve", tone: "seal" };
    case "reserve_redeem":
      return { what: "Redeemed reserve cash for upcoming payment buffer" };
    case "invoice_declined": {
      const why = String(((rec?.inputs ?? {}) as { reason?: unknown }).reason ?? "");
      return { what: `Declined invoice ${subjectShort}${why ? `: ${why}` : ""}`, tone: "red" };
    }
    case "invoice_reopened": {
      const was = String(((rec?.inputs ?? {}) as { previousReason?: unknown }).previousReason ?? "");
      return { what: `Reopened invoice ${subjectShort}${was ? ` (it had been declined: ${was})` : ""}` };
    }
    case "early_pay_offered":
      return { what: `Vendor submitted early pay cash-now offer for ${subjectShort}` };
    default:
      // every other recorded action has its own plain sentence (and a readable fallback), never "Decision: some_code"
      return { what: summarizeDecision((rec ?? { kind: d.kind }) as Record<string, unknown>).sentence };
  }
}

const VIEW_SYNC_WINDOW_BLOCKS = 20_000n;
const VIEW_SYNC_DEADLINE_MS = 4_000;

async function syncVaultForView(db: Database, client: PublicClient, deployment: Deployment, businessId: string, vault: string): Promise<void> {
  try {
    const fromBlock = await ensureVaultBlock(db, client, deployment, businessId, vault);
    const late = new Promise<void>((resolve) => setTimeout(resolve, VIEW_SYNC_DEADLINE_MS));
    const sync = syncVault(db, client, deployment, getAddress(vault), { fromBlock, maxBlocks: VIEW_SYNC_WINDOW_BLOCKS }).then(
      () => undefined,
      (error) => console.error("activity: vault sync failed", error instanceof Error ? error.message : error),
    );
    await Promise.race([sync, late]);
  } catch (error) {
    console.error("activity: couldn't start the vault sync", error instanceof Error ? error.message : error);
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
  opts: { deployment?: Deployment } = {},
): Promise<ActivityFeed> {
  await requireMember(db, user.id, businessId);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
  if (!business) throw new AuthError(404, "Business not found");

  const vault = business.vault?.toLowerCase() ?? "";

  // Bring the Vault's own events forward by one bounded window before reading (plan 05zj E, SYM-14, D7 a): a page that only read
  // what a Steward run or the cron had stored showed an empty Activity until one of those ran. It never holds the page past its
  // deadline; what it hasn't read yet arrives on the next view.
  if (client && vault && opts.deployment) {
    await syncVaultForView(db, client, opts.deployment, businessId, vault);
    await backfillDeposits(db, client, opts.deployment, businessId, getAddress(vault));
  }

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
      displayName: users.displayName,
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

  // checksummed, shortened; a person without a name or email is their role and wallet, never a bare lowercase address (QA R7-2, SYM-49)
  const shortWallet = (a: string) => {
    const c = isAddress(a) ? getAddress(a) : a;
    return `${c.slice(0, 6)}…${c.slice(-4)}`;
  };
  const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);
  const personLabel = (m: { displayName: string | null; email: string | null; wallet: string | null; role: string }) =>
    m.displayName || m.email || `${roleName(m.role)} ${m.wallet ? shortWallet(m.wallet) : ""}`.trim();

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
      return { kind: "person", label: personLabel(mem), wallet: callerAddr };
    }
    const vendorName = sealMap.get(lower);
    if (vendorName) {
      return { kind: "vendor", label: vendorName, wallet: callerAddr };
    }
    return { kind: "person", label: shortWallet(lower), wallet: callerAddr };
  }

  function resolveActorForDecision(d: typeof decisions.$inferSelect): ActivityActor {
    const rec = d.record as Record<string, unknown> | null;
    const recInputs = rec?.inputs as Record<string, unknown> | null;
    const actorId = (recInputs as { actor?: string } | null)?.actor;
    // a record written from the chain's own logs (no person or Steward did it)
    if (actorId === "chain") return { kind: "system", label: "Read from Arc" };
    if (actorId) {
      const mem = memberByUserId.get(actorId);
      if (mem) {
        return { kind: "person", label: personLabel(mem) };
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

  // what a decision's subject is called to a person: an invoice by number and vendor, a vendor by name
  const refFor = (subject: string): string | undefined => {
    const inv = invoiceByFp.get(subject.toLowerCase());
    if (inv) return `${inv.invoiceNumber} from ${sealMap.get(inv.seal.toLowerCase()) || inv.seal}`;
    const vendor = sealMap.get(subject.toLowerCase());
    if (vendor) return vendor;
    return undefined;
  };

  for (const d of decRows) {
    if (isPreparedPayment(d.record)) continue;
    let desc = describeDecision(d, refFor);
    // a reopen recorded before the reason was stored with it: take it from the decline it undid (QA R7-2)
    if (d.kind === "invoice_reopened" && d.subject && !String((d.record as { inputs?: { previousReason?: unknown } } | null)?.inputs?.previousReason ?? "")) {
      const earlier = decRows.find((x) => x.kind === "invoice_declined" && x.subject === d.subject && x.createdAt.getTime() <= d.createdAt.getTime());
      const why = String((earlier?.record as { inputs?: { reason?: unknown } } | undefined)?.inputs?.reason ?? "");
      if (why) desc = { what: `${desc.what} (it had been declined: ${why})` };
    }
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
  const whoOptions = ["All", "Steward", "Vault", ...new Set(memberRows.map((m) => personLabel(m)))];
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
