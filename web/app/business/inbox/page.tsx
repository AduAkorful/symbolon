import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { InboxActions } from "@/components/inbox/InboxActions";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { ensureFresh } from "@/lib/server/sync";
import { listInbox, type InboxFilter } from "@/lib/server/inbox";

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
  const items = await listInbox(db, getClient(), cfg, session.user, business.id, filter);
  const inboxCount = filter === "all" ? items.length : (await listInbox(db, getClient(), cfg, session.user, business.id, "all")).length;
  return (
    <Shell where={where} current={{ kind: "business", id: business.id }} inboxCount={inboxCount}>
      <div className="max-w-[1080px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="font-display text-5xl">Inbox</h1><p className="mt-2 max-w-[62ch] text-graphite">Invoices and bills addressed to {business.name}. Trust comes from the Seal, your records and the Vault—not from the upload.</p></div>
          <Link href="/business" className="text-sm underline decoration-rule underline-offset-4">Business home</Link>
        </div>
        <p className={`mt-5 text-xs ${sync.ok ? "text-graphite" : "text-red"}`}>{sync.ok ? "Ledger mirror refreshed or already current." : `Ledger sync is unavailable: ${sync.reason}`}</p>
        <InboxActions businessId={business.id} />
        <nav aria-label="Inbox filters" className="mt-8 flex flex-wrap gap-2 border-b border-rule pb-3">
          {filters.map(([value, label]) => <Link key={value} href={`/business/inbox${value === "all" ? "" : `?filter=${value}`}`} className={`rounded-full border px-3 py-1 text-sm ${filter === value ? "border-ink bg-ink text-paper" : "border-rule"}`}>{label}</Link>)}
        </nav>
        <div className="mt-4 divide-y divide-rule border-t border-ink">
          {items.length ? items.map((item) => <Link key={`${item.kind}:${item.id}`} href={item.kind === "invoice" ? `/business/inbox/${item.fingerprint}` : `/business/inbox/unsigned/${item.id}`} className="grid gap-2 py-4 hover:bg-paper-raised md:grid-cols-[1fr_auto_auto] md:items-center md:gap-6">
            <span><span className="font-medium">{item.vendor}</span><span className="ml-3 font-mono text-xs text-graphite">{item.invoiceNumber ?? "Unsigned bill"}</span><span className="block text-sm text-graphite">{item.kind === "unsigned" ? item.assessment?.verdict : `${item.trust} · ${item.status}`}</span></span>
            <span className="text-right font-mono text-sm">{item.amount ? `${item.amount} ${item.token}` : "Held"}</span>
            <span className="text-right text-sm text-graphite">{item.dueDate ? item.dueDate.toISOString().slice(0, 10) : item.createdAt.toISOString().slice(0, 10)}</span>
          </Link>) : <p className="py-10 text-sm text-graphite">Nothing in this view yet.</p>}
        </div>
      </div>
    </Shell>
  );
}
