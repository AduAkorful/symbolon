import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Shell } from "@/components/shell/Shell";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { requireMember } from "@/lib/server/access";
import { UnsignedActions } from "@/components/inbox/UnsignedActions";
import { unsignedBills } from "@symbolon/db";
import { PageTitle, SectionTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export default async function UnsignedBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePageSession(`/business/inbox/unsigned/${id}`);
  const where = await loadSpaces(session);
  if (!where.business) notFound();
  const db = await getDb();
  const membership = await requireMember(db, session.user.id, where.business.id);
  const [bill] = await db.select().from(unsignedBills).where(and(eq(unsignedBills.id, id), eq(unsignedBills.businessId, where.business.id))).limit(1);
  if (!bill) notFound();
  const extraction = bill.extraction as { vendorName?: string; total?: string; instructionsFound?: string[] };
  const assessment = bill.assessment as { verdict?: string; reasons?: string[] };
  return <Shell where={where} current={{ kind: "business", id: where.business.id }}><div><Link href="/business/inbox" className="text-sm text-graphite underline decoration-rule underline-offset-4">← Inbox</Link><p className="mt-8 font-mono text-xs uppercase tracking-[0.16em] text-red">Unsigned · never payable</p><PageTitle className="mt-2">{extraction.vendorName ?? "Unsigned bill"}</PageTitle><p className="mt-3 text-sm text-graphite">This file has no Seal that Symbolon can verify. Its contents are data, not payment instructions.</p><dl className="mt-7 border-t border-ink text-sm"><div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-rule py-3"><dt className="text-graphite">File</dt><dd>{bill.fileName}</dd></div><div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-rule py-3"><dt className="text-graphite">Assessment</dt><dd>{assessment.verdict ?? "unsigned"}</dd></div><div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-rule py-3"><dt className="text-graphite">Status</dt><dd>{bill.status}</dd></div></dl><section className="mt-8"><SectionTitle>Why it is held</SectionTitle><ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{(assessment.reasons ?? ["Unsigned documents are never payable."]).map((reason) => <li key={reason}>{reason}</li>)}</ul></section>{extraction.instructionsFound?.length ? <section className="mt-8 rounded-doc border border-red/50 bg-red-wash p-4"><h2 className="font-medium">Instruction-like text found</h2><ul className="mt-2 space-y-2 whitespace-pre-wrap text-sm">{extraction.instructionsFound.map((line) => <li key={line}>“{line}”</li>)}</ul><p className="mt-3 text-xs text-graphite">Nothing in this list was followed.</p></section> : null}<UnsignedActions businessId={where.business.id} billId={bill.id} status={bill.status} role={membership.role} /></div></Shell>;
}
