import { notFound } from "next/navigation";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { CopyLink } from "@/components/vendor/CopyLink";
import { Shell } from "@/components/shell/Shell";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { myInvoice } from "@/lib/server/invoice-send";
import { requireVendorPage } from "@/lib/server/vendor-page";
import { toneClass, vendorStatus } from "@/lib/invoice-status";

export const dynamic = "force-dynamic";

/** One of the vendor's own invoices: the sealed document, its status and the link to send. Someone else's fingerprint is a 404. */
export default async function VendorInvoice({ params }: { params: Promise<{ fingerprint: string }> }) {
  const { fingerprint } = await params;
  const { session, seal, where } = await requireVendorPage(`/v/invoices/${fingerprint}`);
  const found = await myInvoice(await getDb(), session.user, fingerprint);
  if (!found) notFound();
  const st = vendorStatus(found.row.status);
  const link = `${getConfig().appOrigin}/p/invoice/${found.row.fingerprint}`;
  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <InvoiceDoc document={found.sealed.document} fingerprint={found.row.fingerprint} handle={seal.handle} sealed={found.row.status !== "rejected"} />
        <section className="lg:pt-6">
          <p className={`font-mono text-xs uppercase tracking-[0.16em] ${toneClass[st.tone]}`}>{st.label}</p>
          <h1 className="mt-2 font-display text-4xl leading-none">Invoice {found.row.invoiceNumber}</h1>
          <p className="mt-3 max-w-[52ch] text-graphite">To {found.sealed.document.payer.name}. Send them this link; anyone who has it can open the invoice and check it.</p>
          <CopyLink link={link} />
        </section>
      </div>
    </Shell>
  );
}
