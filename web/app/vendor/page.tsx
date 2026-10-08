import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { listClients, mySeal } from "@/lib/server/vendor";
import { listMyInvoices } from "@/lib/server/invoice-send";
import { loadSpaces } from "@/lib/server/space";
import { showAmount, showDate } from "@/lib/format";
import { vendorStatus } from "@/lib/invoice-status";
import { pillTone } from "@/lib/status-tone";
import { Address } from "@/components/Address";
import { LinkButton } from "@/components/ui/button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Eyebrow, PageTitle, SectionTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

/** A vendor's home: their Seal and their latest invoices. Without a Seal, the way to register one. */
export default async function VendorHome() {
  const session = await requirePageSession("/vendor");
  const db = await getDb();
  const seal = await mySeal(db, session.user.id);
  if (!seal) redirect("/vendor/start");
  const where = await loadSpaces(session);
  const [invoices, clients] = await Promise.all([listMyInvoices(db, session.user), listClients(db, session.user)]);

  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <Eyebrow>@{seal.handle}</Eyebrow>
            <PageTitle className="mt-1">{seal.displayName}</PageTitle>
          </div>
          <LinkButton href="/vendor/new">New invoice</LinkButton>
        </div>

        <dl className="mt-8 divide-y divide-rule-soft rounded-doc border border-rule px-5 text-sm">
          <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-graphite">Your Seal</dt>
            <dd className="min-w-0"><Address value={seal.address} full copy /></dd>
          </div>
          <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-graphite">Sent so far</dt>
            <dd>{invoices.length} {invoices.length === 1 ? "invoice" : "invoices"} to {clients.length} {clients.length === 1 ? "client" : "clients"}</dd>
          </div>
        </dl>

        <SectionTitle className="mt-12">Latest invoices</SectionTitle>
        {invoices.length === 0 ? (
          <EmptyState title="No invoices yet" className="mt-4" action={<LinkButton href="/vendor/new">Write your first invoice</LinkButton>}>
            Write one, sign it with your wallet, and you get a link to send.
          </EmptyState>
        ) : (
          <DataTable
            className="mt-4"
            caption="Your latest invoices"
            rows={invoices.slice(0, 5)}
            rowKey={(i) => i.fingerprint}
            columns={[
              { key: "client", header: "Client", primary: true, cell: (i) => <Link href={`/vendor/invoices/${i.fingerprint}`} className="underline decoration-rule underline-offset-4 hover:decoration-ink">{i.clientName}</Link> },
              { key: "amount", header: "Amount", amount: true, cell: (i) => `${showAmount(i.total)} ${i.symbol}` },
              { key: "no", header: "Invoice", nowrap: true, cell: (i) => `No. ${i.invoiceNumber}` },
              { key: "due", header: "Due", nowrap: true, cell: (i) => showDate(Math.floor(i.dueDate.getTime() / 1000)) },
              { key: "status", header: "Status", cell: (i) => { const st = vendorStatus(i.status); return <StatusPill tone={pillTone[st.tone]}>{st.label}</StatusPill>; } },
            ]}
          />
        )}
        {invoices.length > 5 ? <p className="mt-4 text-sm"><Link href="/vendor/invoices" className="text-graphite underline decoration-rule underline-offset-4 hover:text-ink">All {invoices.length} invoices →</Link></p> : null}
      </div>
    </Shell>
  );
}
