import { notFound } from "next/navigation";
import { Reveal } from "@/components/app/Reveal";
import { VInvoiceView } from "@/components/vendor/VInvoiceView";
import { vInvoiceById, vInvoices } from "@/lib/ana";

export function generateStaticParams() {
  return vInvoices.map((i) => ({ id: i.id }));
}

export default async function VInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = vInvoiceById(id);
  if (!inv) notFound();
  return (
    <Reveal>
      <VInvoiceView inv={inv} />
    </Reveal>
  );
}
