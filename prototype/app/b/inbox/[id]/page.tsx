import { notFound } from "next/navigation";
import { InvoiceDetail } from "@/components/app/InvoiceDetail";
import { RefusalView } from "@/components/app/RefusalView";
import { Reveal } from "@/components/app/Reveal";
import { invoiceById, invoices } from "@/lib/acme";

export function generateStaticParams() {
  return invoices.map((i) => ({ id: i.id }));
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = invoiceById(id);
  if (!inv) notFound();
  return <Reveal>{inv.trust === "unsigned" ? <RefusalView /> : <InvoiceDetail inv={inv} />}</Reveal>;
}
