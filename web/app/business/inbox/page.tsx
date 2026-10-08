import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { InboxActions } from "@/components/inbox/InboxActions";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { ensureFresh } from "@/lib/server/sync";
import { filterInbox, listInbox, type InboxFilter } from "@/lib/server/inbox";
import { businessStatus, statusToneClass, trustName, unsignedLabel } from "@/lib/business-status";
import { formatDay, showMoney } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { chipClass } from "@/components/ui/chip";
import { Money } from "@/components/ui/Money";
import { EmptyState } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { pillTone } from "@/lib/status-tone";
import { Lead, PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const filters: [InboxFilter, string][] = [["all", "All"], ["verified", "Verified"], ["new", "New vendor"], ["unsigned", "Unsigned"], ["blocked", "Blocked"]];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const session = await requirePageSession("/business/inbox");
  const where = await loadSpaces(session);
  const business = where.business;
  if (!business) return <Shell where={where} current={{ kind: "business", id: "" }}><p>You don’t belong to a business yet.</p></Shell>;
  const cfg = getConfig();
  const db = await getDb();
  const sync = await ensureFresh(db, getClient(), cfg);
  const query = await searchParams;
  const requested = query.filter as InboxFilter | undefined;
  const filter = requested && filters.some(([value]) => value === requested) ? requested : "all";
  const everything = await listInbox(db, getClient(), cfg, session.user, business.id, "all");
  const matching = filterInbox(everything, filter);
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1));
  const items = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (n > 1) params.set("page", String(n));
    const q = params.toString();
    return `/business/inbox${q ? `?${q}` : ""}`;
  };
  return (
    <Shell where={where} current={{ kind: "business", id: business.id }}>
      <div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <PageTitle>Inbox</PageTitle>
            <Lead className="mt-3">Invoices and bills addressed to {business.name}. Trust comes from the vendor’s Seal, your records and the Vault, not from the upload.</Lead>
          </div>
          <InboxActions businessId={business.id} />
        </div>
        {!sync.ok || sync.catchingUp ? (
          <Callout tone={sync.ok ? "neutral" : "warn"} className="mt-5">
            {sync.ok
              ? "Payment records from Arc are still being collected. Statuses below are read from Arc directly; the history fills in over the next minutes."
              : `Payment records from Arc can't be updated right now (${sync.reason}). Statuses below are read from Arc directly.`}
          </Callout>
        ) : null}
        <nav aria-label="Inbox filters" className="mt-8 flex flex-wrap gap-2">
          {filters.map(([value, label]) => (
            <Link
              key={value}
              href={`/business/inbox${value === "all" ? "" : `?filter=${value}`}`}
              aria-current={filter === value ? "page" : undefined}
              className={chipClass(filter === value)}
            >
              {label}
              <span className={filter === value ? "text-paper/70" : "text-graphite"}>{filterInbox(everything, value).length}</span>
            </Link>
          ))}
        </nav>
        {items.length ? (
          <ul className="mt-5 divide-y divide-rule-soft border-y border-rule">
            {items.map((item) => {
              const state = item.kind === "unsigned" ? unsignedLabel(item.assessment?.verdict, item.status) : businessStatus(item.status, { source: item.holdSource, kind: item.holdKind });
              const trust = item.kind === "invoice" && item.trust ? trustName(item.trust) : null;
              return (
                <li key={`${item.kind}:${item.id}`}>
                  <Link
                    href={item.kind === "invoice" ? `/business/inbox/${item.fingerprint}` : `/business/inbox/unsigned/${item.id}`}
                    className="grid gap-x-6 gap-y-1 px-1 py-4 transition-colors hover:bg-paper-raised md:grid-cols-[minmax(0,1fr)_auto_9.5rem] md:items-center"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-baseline gap-x-3">
                        <span className="truncate font-medium text-ink">{item.vendor}</span>
                        <span className="text-sm text-graphite">{item.invoiceNumber ?? "Unsigned bill"}</span>
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <StatusPill tone={pillTone[state.tone]}>{state.label}</StatusPill>
                        {state.note ? <span className="text-sm text-graphite">{state.note}</span> : null}
                        {trust && trust.tone !== "seal" ? <span className={`text-sm ${statusToneClass[trust.tone]}`}>{trust.label}</span> : null}
                      </span>
                    </span>
                    <Money className="font-medium text-ink md:text-right">{item.kind === "invoice" ? (item.amount ? showMoney(item.amount, item.token ?? "") : "Can’t read") : "No amount"}</Money>
                    <span className="whitespace-nowrap text-sm text-graphite md:text-right">{item.dueDate ? `Due ${formatDay(item.dueDate)}` : `Received ${formatDay(item.createdAt)}`}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Nothing in this view" className="mt-5">{filter === "all" ? "Invoices that vendors send you, and bills you upload, appear here." : "No invoices match this filter."}</EmptyState>
        )}
        {pages > 1 ? (
          <nav aria-label="Inbox pages" className="mt-5 flex items-center justify-between gap-4 text-sm text-graphite">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, matching.length)} of {matching.length}
            </span>
            <span className="flex gap-2">
              {page > 1 ? <Link href={pageHref(page - 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>Previous</Link> : null}
              {page < pages ? <Link href={pageHref(page + 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>Next</Link> : null}
            </span>
          </nav>
        ) : null}
      </div>
    </Shell>
  );
}
