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

export const dynamic = "force-dynamic";

const filters: [InboxFilter, string][] = [["all", "All"], ["verified", "Verified"], ["new", "New vendor"], ["unsigned", "Unsigned"], ["blocked", "Blocked"]];

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const session = await requirePageSession("/business/inbox");
  const where = await loadSpaces(session);
  const business = where.business;
  if (!business) return <Shell where={where} current={{ kind: "business", id: "" }}><p>You don’t belong to a business yet.</p></Shell>;
  const cfg = getConfig();
  const db = await getDb();
  const sync = await ensureFresh(db, getClient(), cfg);
  const requested = (await searchParams).filter as InboxFilter | undefined;
  const filter = requested && filters.some(([value]) => value === requested) ? requested : "all";
  const everything = await listInbox(db, getClient(), cfg, session.user, business.id, "all");
  const items = filterInbox(everything, filter);
  return (
    <Shell where={where} current={{ kind: "business", id: business.id }}>
      <div className="max-w-[1080px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="font-display text-5xl">Inbox</h1><p className="mt-2 max-w-[62ch] text-graphite">Invoices and bills addressed to {business.name}. Trust comes from the Seal, your records and the Vault—not from the upload.</p></div>
          <Link href="/business" className="text-sm underline decoration-rule underline-offset-4">Business home</Link>
        </div>
        {!sync.ok || sync.catchingUp ? (
          <p className={`mt-5 text-xs ${sync.ok ? "text-graphite" : "text-red"}`} role="status">
            {sync.ok
              ? "Payment records from Arc are still being collected. Statuses below are read from Arc directly; the history fills in over the next minutes."
              : `Payment records from Arc can't be updated right now (${sync.reason}). Statuses below are read from Arc directly.`}
          </p>
        ) : null}
        <InboxActions businessId={business.id} />
        <nav aria-label="Inbox filters" className="mt-8 flex flex-wrap gap-2 border-b border-rule pb-3">
          {filters.map(([value, label]) => <Link key={value} href={`/business/inbox${value === "all" ? "" : `?filter=${value}`}`} aria-current={filter === value ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${filter === value ? "border-ink bg-ink text-paper" : "border-rule"}`}>{label} <span className="tabular-nums opacity-70">{filterInbox(everything, value).length}</span></Link>)}
        </nav>
        <div className="mt-4 divide-y divide-rule border-t border-ink">
          {items.length ? items.map((item) => {
            const state = item.kind === "unsigned" ? unsignedLabel(item.assessment?.verdict, item.status) : businessStatus(item.status, { source: item.holdSource, kind: item.holdKind });
            const trust = item.kind === "invoice" && item.trust ? trustName(item.trust) : null;
            return (
              <Link key={`${item.kind}:${item.id}`} href={item.kind === "invoice" ? `/business/inbox/${item.fingerprint}` : `/business/inbox/unsigned/${item.id}`} className="grid gap-2 py-4 hover:bg-paper-raised md:grid-cols-[1fr_auto_auto] md:items-center md:gap-6">
                <span>
                  <span className="font-medium">{item.vendor}</span>
                  <span className="ml-3 font-mono text-xs text-graphite">{item.invoiceNumber ?? "Unsigned bill"}</span>
                  <span className="block text-sm">
                    <span className={statusToneClass[state.tone]}>{state.label}</span>
                    {state.note ? <span className="text-graphite"> · {state.note}</span> : null}
                  </span>
                  {trust ? <span className={`block text-xs ${statusToneClass[trust.tone]}`}>{trust.label}</span> : null}
                </span>
                <span className="text-right font-mono text-sm tabular-nums">{item.kind === "invoice" ? (item.amount ? showMoney(item.amount, item.token ?? "") : "Can't read") : "No amount"}</span>
                <span className="text-right text-sm text-graphite">{item.dueDate ? `Due ${formatDay(item.dueDate)}` : `Received ${formatDay(item.createdAt)}`}</span>
              </Link>
            );
          }) : <p className="py-10 text-sm text-graphite">Nothing in this view yet.</p>}
        </div>
      </div>
    </Shell>
  );
}
