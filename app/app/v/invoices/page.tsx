import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { listMyInvoices } from "@/lib/server/invoice-send";
import { requireVendorPage } from "@/lib/server/vendor-page";
import { showAmount, showDate } from "@/lib/format";
import { toneClass, vendorStatus } from "@/lib/invoice-status";

export const dynamic = "force-dynamic";

export default async function VendorInvoices() {
  const { session, where } = await requireVendorPage("/v/invoices");
  const invoices = await listMyInvoices(await getDb(), session.user);
  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div className="max-w-[900px]">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="font-display text-4xl leading-tight">Invoices</h1>
          <Link href="/v/new" className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
            New invoice
          </Link>
        </div>
        {invoices.length === 0 ? (
          <p className="mt-6 text-graphite">Nothing here yet. Invoices you sign appear here with their link.</p>
        ) : (
          <table className="mt-6 w-full text-left text-sm">
            <thead className="text-graphite">
              <tr className="border-b border-rule">
                <th className="py-2 pr-4 font-normal">No.</th>
                <th className="py-2 pr-4 font-normal">Client</th>
                <th className="py-2 pr-4 text-right font-normal">Amount</th>
                <th className="hidden py-2 pr-4 font-normal sm:table-cell">Due</th>
                <th className="py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const st = vendorStatus(i.status);
                return (
                  <tr key={i.fingerprint} className="border-b border-rule-soft hover:bg-rule-soft/40">
                    <td className="py-3 pr-4 font-mono">
                      <Link href={`/v/invoices/${i.fingerprint}`} className="underline decoration-rule underline-offset-4">
                        {i.invoiceNumber}
                      </Link>
                    </td>
                    <td className="max-w-[16rem] truncate py-3 pr-4">{i.clientName}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {showAmount(i.total)} {i.symbol}
                    </td>
                    <td className="hidden py-3 pr-4 sm:table-cell">{showDate(Math.floor(i.dueDate.getTime() / 1000))}</td>
                    <td className={`py-3 ${toneClass[st.tone]}`}>{st.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
