import Link from "next/link";
import { Reveal } from "@/components/app/Reveal";
import { Money } from "@/components/Money";
import { VStatusTag } from "@/components/vendor/VStatusTag";
import { vInvoices } from "@/lib/ana";

export default function VendorInvoices() {
  return (
    <Reveal>
      <main className="px-6 pb-24 pt-10 md:px-10">
        <div data-reveal className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-display text-5xl">Invoices</h1>
          <div className="flex gap-3">
            <Link href="/v/upload" className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
              Upload a PDF
            </Link>
            <Link href="/v/new" className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
              New invoice
            </Link>
          </div>
        </div>
        <div data-reveal className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[680px] border-t border-ink text-[15px]">
            <thead>
              <tr className="text-left text-xs text-graphite">
                <th className="py-3 pr-4 font-normal">No.</th>
                <th className="py-3 pr-4 font-normal">Client</th>
                <th className="py-3 pr-4 text-right font-normal">Amount</th>
                <th className="py-3 pr-4 font-normal">Due</th>
                <th className="py-3 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {vInvoices.map((i) => (
                <tr key={i.id} className="group border-t border-rule">
                  <td className="pr-4 font-mono text-sm">
                    <Link href={`/v/invoices/${i.id}`} className="block py-4 group-hover:text-seal">
                      {i.number}
                    </Link>
                  </td>
                  <td className="pr-4">
                    {i.client}
                    {!i.clientOn ? <span className="ml-2 text-xs text-graphite">invited</span> : null}
                  </td>
                  <td className="pr-4 text-right">
                    <Money raw={i.amount} symbol="$" precise={false} tabular />
                  </td>
                  <td className="pr-4 text-graphite">{i.due}</td>
                  <td>
                    <VStatusTag status={i.status} />
                    <p className="text-xs text-graphite">{i.note}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </Reveal>
  );
}
