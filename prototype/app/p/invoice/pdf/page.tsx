import { SealStamp } from "@/components/Marks";
import { QR } from "@/components/QR";
import { invoice, payer, vendor } from "@/lib/demo";

const f = (raw: string) => Number(raw).toLocaleString("en-US", { minimumFractionDigits: 2 });

/** The invoice as a printable PDF (P5): A4, with the link and code that lead back to the sealed original */
export default function InvoicePdf() {
  return (
    <div className="min-h-screen bg-rule-soft py-10 print:bg-white print:py-0">
      <article className="mx-auto aspect-[210/297] w-full max-w-[794px] bg-white p-[56px] text-[13px] text-[#15211c] shadow-xl print:shadow-none">
        <header className="flex items-start justify-between">
          <div>
            <p className="font-display text-4xl leading-none">{vendor.name}</p>
            <p className="mt-2 text-[#5d6b63]">Rua das Flores 21, Lisbon · studio-ana.com</p>
          </div>
          <SealStamp handle={vendor.handle} size={84} className="rotate-[-8deg]" />
        </header>
        <div className="mt-12 grid grid-cols-2 gap-8">
          <div>
            <p className="text-[#5d6b63]">Billed to</p>
            <p className="mt-1 font-medium">{payer.name}</p>
            <p>{payer.email}</p>
          </div>
          <dl className="grid grid-cols-2 gap-y-1 text-right">
            <dt className="text-[#5d6b63]">Invoice</dt>
            <dd>No. {invoice.number}</dd>
            <dt className="text-[#5d6b63]">Issued</dt>
            <dd>{invoice.issued}</dd>
            <dt className="text-[#5d6b63]">Due</dt>
            <dd>{invoice.due}</dd>
          </dl>
        </div>
        <table className="mt-12 w-full">
          <thead>
            <tr className="border-b border-[#15211c] text-left text-[#5d6b63]">
              <th className="py-2 font-normal">Item</th>
              <th className="py-2 text-right font-normal">Amount (USDC)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.description} className="border-b border-[#cdd9c7]">
                <td className="py-2.5">{l.description}</td>
                <td className="py-2.5 text-right">{f(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-4 font-medium">Total</td>
              <td className="pt-4 text-right font-display text-3xl">{f(invoice.total)} USDC</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-6 text-[#5d6b63]">
          Early payment: {invoice.earlyPay.filter((t) => t.bps).map((t) => `${(t.bps / 100).toFixed(2)}% off until ${t.until} (${f(t.pay)})`).join(" · ")}
        </p>
        <footer className="mt-16 flex items-end justify-between gap-8 border-t border-[#a9bca3] pt-6">
          <div className="max-w-[60%]">
            <p className="font-medium">Pay or verify this invoice</p>
            <p className="mt-1 font-mono">symbolon.xyz/i/7c2e91a4</p>
            <p className="mt-2 text-[#5d6b63]">
              This PDF is a copy. The sealed original is at the link; if the two differ, the link is right. Paid in USDC on Arc to the address
              Studio Ana’s Seal signed.
            </p>
          </div>
          <QR seed="0x7c2e91a4d05b3f68e2a1c9407b5d13e8a6f2904c1d7e35b8a02f6c91e4d8b37a" className="h-28 w-28 bg-white" />
        </footer>
      </article>
    </div>
  );
}
