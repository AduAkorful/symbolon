import { notFound } from "next/navigation";
import Link from "next/link";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { DeliveryActions } from "@/components/inbox/DeliveryActions";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { loadInvoiceDetail } from "@/lib/server/inbox";

export const dynamic = "force-dynamic";

export default async function BusinessInvoice({ params }: { params: Promise<{ fingerprint: string }> }) {
  const { fingerprint } = await params;
  const session = await requirePageSession(`/business/inbox/${fingerprint}`);
  const where = await loadSpaces(session);
  if (!where.business) notFound();
  const view = await loadInvoiceDetail(await getDb(), getClient(), getConfig(), session.user, where.business.id, fingerprint);
  if (!view || !view.verification.document) notFound();
  const handle = view.vendor?.handle ?? (view.verification.document.vendor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vendor");

  // Check whether delivery evidence exists in the db (N13: show confirm/reject buttons)
  const dbDeliveryRow = view.evidence.rows.find((r) => r.label === "Delivery");
  const hasDeliveryConfirmed = dbDeliveryRow?.value.startsWith("Delivery confirmed");
  const hasDeliveryRejected = dbDeliveryRow?.value.startsWith("Delivery rejected:");
  const currentDeliveryState = hasDeliveryConfirmed ? "confirmed" : hasDeliveryRejected ? "rejected" : null;
  const rejectionReason = hasDeliveryRejected ? dbDeliveryRow?.value.replace("Delivery rejected: ", "") : null;

  // Show delivery actions when: invoice is not paid/cancelled and (delivery required or already has a row)
  const showDeliveryActions =
    view.row.status !== "paid" &&
    view.row.status !== "cancelled" &&
    view.row.status !== "rejected" &&
    view.verification.ok;

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <div className="grid max-w-[1180px] gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <InvoiceDoc document={view.verification.document} fingerprint={fingerprint} handle={handle} sealed={view.verification.ok} />
        <section className="lg:pt-6">
          <Link href="/business/inbox" className="text-sm text-graphite underline decoration-rule underline-offset-4">
            ← Inbox
          </Link>
          <p className="mt-6 font-mono text-xs uppercase tracking-[0.16em]">
            {view.evidence.matched ? "Matched" : "Evidence still open"}
          </p>
          <h1 className="mt-2 font-display text-4xl">Invoice {view.row.invoiceNumber}</h1>
          <p className="mt-3 text-sm text-graphite">
            The vendor's sealed half is shown beside the checks Symbolon can make for this business right now.
            Matched does not mean paid.
          </p>

          {/* Evidence rows */}
          <ul className="mt-7 border-t border-ink">
            {view.evidence.rows.map((row) => (
              <li
                key={row.label}
                className="grid gap-1 border-b border-rule py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"
              >
                <span className="text-sm text-graphite">{row.label}</span>
                <span className={row.state === "blocks" ? "text-red" : row.state === "missing" ? "text-graphite" : ""}>
                  {row.value}
                  <span className="mt-1 block text-xs text-graphite">{row.source}</span>
                </span>
              </li>
            ))}
          </ul>

          {/* Delivery confirm/reject panel (N13) */}
          {showDeliveryActions ? (
            <div className="mt-6">
              <DeliveryActions
                businessId={where.business.id}
                fingerprint={fingerprint}
                currentState={currentDeliveryState}
                currentReason={rejectionReason ?? null}
              />
            </div>
          ) : null}

          {view.trust === "new_vendor" ? (
            <p className="mt-5 rounded-doc border border-rule p-4 text-sm">
              This invoice is sealed, but the vendor still needs a first-contact verification before the business can
              trust the relationship.
            </p>
          ) : null}

          {view.holdSource === "human" ? (
            <p className="mt-5 rounded-doc border border-rule/60 bg-red-wash/20 p-4 text-sm text-red">
              This invoice is held because delivery was rejected. Confirm delivery to release it.
            </p>
          ) : view.holdSource === "steward" ? (
            <p className="mt-5 rounded-doc border border-rule p-4 text-sm text-graphite">
              The Steward is holding this invoice pending re-evaluation. No action required from you.
            </p>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
