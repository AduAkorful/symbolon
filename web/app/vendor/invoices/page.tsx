import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { listMyInvoices } from "@/lib/server/invoice-send";
import { requireVendorPage } from "@/lib/server/vendor-page";
import { showAmount, showDate } from "@/lib/format";
import { vendorStatus } from "@/lib/invoice-status";
import { pillTone } from "@/lib/status-tone";
import { LinkButton } from "@/components/ui/button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export default async function VendorInvoices() {
  const { session, where } = await requireVendorPage("/vendor/invoices");
  const invoices = await listMyInvoices(await getDb(), session.user);
  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <PageTitle>Invoices</PageTitle>
          <LinkButton href="/vendor/new">New invoice</LinkButton>
        </div>
        {invoices.length === 0 ? (
          <EmptyState title="No invoices yet" className="mt-8">Invoices you sign appear here with their link.</EmptyState>
        ) : (
          <DataTable
            className="mt-8"
            caption="Your invoices"
            rows={invoices}
            rowKey={(i) => i.fingerprint}
            columns={[
              { key: "client", header: "Client", primary: true, cell: (i) => i.clientName },
              { key: "amount", header: "Amount", amount: true, cell: (i) => `${showAmount(i.total)} ${i.symbol}` },
              { key: "no", header: "Invoice", nowrap: true, cell: (i) => <Link href={`/vendor/invoices/${i.fingerprint}`} className="underline decoration-rule underline-offset-4 hover:decoration-ink">No. {i.invoiceNumber}</Link> },
              { key: "due", header: "Due", nowrap: true, cell: (i) => showDate(Math.floor(i.dueDate.getTime() / 1000)) },
              { key: "status", header: "Status", cell: (i) => { const st = vendorStatus(i.status); return <StatusPill tone={pillTone[st.tone]}>{st.label}</StatusPill>; } },
            ]}
          />
        )}
      </div>
    </Shell>
  );
}
