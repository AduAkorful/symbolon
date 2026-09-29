import { notFound } from "next/navigation";
import { EarlyPay } from "@/components/vendor/EarlyPay";
import { vInvoiceById } from "@/lib/ana";

export default async function EarlyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = vInvoiceById(id);
  if (!inv || !inv.clientOn || inv.status === "paid") notFound();
  return <EarlyPay inv={inv} />;
}
