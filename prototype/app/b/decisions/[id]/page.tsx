import { notFound } from "next/navigation";
import { DecisionView } from "@/components/app/DecisionView";
import { Reveal } from "@/components/app/Reveal";
import { decisionById, invoices, type Decision } from "@/lib/acme";

/** Invoices whose decision isn't written out in full get a record built from the invoice itself */
function fromInvoice(id: string): Decision | undefined {
  const inv = invoices.find((i) => i.decisionId === id);
  if (!inv) return undefined;
  return {
    id,
    time: "Earlier",
    trigger: `Invoice ${inv.number} from ${inv.vendor} arrived`,
    summary: inv.steward.says,
    outcome: inv.status === "held" ? "held" : "scheduled",
    invoiceId: inv.id,
    inputs: [
      ["Invoice", `${inv.number} · due ${inv.due} · ${inv.handle ?? "unsigned"}`],
      ...inv.acme.map((h) => [h.label, h.value] as [string, string]),
    ],
    options: [{ option: inv.statusNote, chosen: true, why: inv.steward.rule }],
    rule: inv.steward.rule,
    anchor: { batch: 211, status: "anchored" },
  };
}

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = decisionById(id) ?? fromInvoice(id);
  if (!d) notFound();
  return (
    <Reveal>
      <DecisionView d={d} />
    </Reveal>
  );
}
