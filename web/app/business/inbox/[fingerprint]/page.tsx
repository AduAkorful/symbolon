import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { decisions } from "@symbolon/db";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { DeliveryActions } from "@/components/inbox/DeliveryActions";
import { ReleaseHoldButton } from "@/components/inbox/ReleaseHoldButton";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { loadInvoiceDetail } from "@/lib/server/inbox";
import { summarizeDecision } from "@/lib/server/decision-text";
import { businessOffers } from "@/lib/server/offers";
import { BusinessOffers } from "@/components/inbox/BusinessOffers";
import { buttonClass } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { Eyebrow, PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export default async function BusinessInvoice({ params }: { params: Promise<{ fingerprint: string }> }) {
  const { fingerprint } = await params;
  const session = await requirePageSession(`/business/inbox/${fingerprint}`);
  const where = await loadSpaces(session);
  if (!where.business) notFound();
  const db = await getDb();
  const view = await loadInvoiceDetail(db, getClient(), getConfig(), session.user, where.business.id, fingerprint);
  if (!view || !view.verification.document) notFound();
  const offers = await businessOffers(db, session.user, where.business.id, fingerprint);
  const handle = view.vendor?.handle ?? (view.verification.document.vendor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "vendor");

  // Check whether delivery evidence exists in the db (N13: show confirm/reject buttons)
  const dbDeliveryRow = view.evidence.rows.find((r) => r.label === "Delivery");
  const hasDeliveryConfirmed = dbDeliveryRow?.value.startsWith("Delivery confirmed");
  const hasDeliveryRejected = dbDeliveryRow?.value.startsWith("Delivery rejected:");
  const currentDeliveryState = hasDeliveryConfirmed ? "confirmed" : hasDeliveryRejected ? "rejected" : null;
  const rejectionReason = hasDeliveryRejected ? dbDeliveryRow?.value.replace("Delivery rejected: ", "") : null;

  // Show delivery actions when the invoice is still open and delivery matters: this vendor's terms require it, or someone has
  // already confirmed or rejected it. The evidence row is "info" only when delivery isn't required.
  const deliveryMatters = dbDeliveryRow?.state !== "info" || currentDeliveryState !== null;
  const showDeliveryActions =
    view.row.status !== "paid" &&
    view.row.status !== "cancelled" &&
    view.row.status !== "rejected" &&
    view.verification.ok &&
    deliveryMatters;

  // Latest decision for this invoice
  const [latestDecision] = await db
    .select({
      id: decisions.id,
      record: decisions.record,
      createdAt: decisions.createdAt,
    })
    .from(decisions)
    .where(and(eq(decisions.businessId, where.business.id), eq(decisions.subject, fingerprint)))
    .orderBy(desc(decisions.createdAt))
    .limit(1);

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <InvoiceDoc document={view.verification.document} fingerprint={fingerprint} handle={handle} sealed={view.verification.ok} />
        <section className="min-w-0 lg:pt-6">
          <Link href="/business/inbox" className="text-sm text-graphite underline decoration-rule underline-offset-4 hover:text-ink">
            ← Inbox
          </Link>
          <Eyebrow className="mt-6">{view.evidence.matched ? "Matched" : "Evidence still open"}</Eyebrow>
          <PageTitle className="mt-2">Invoice {view.row.invoiceNumber}</PageTitle>
          <p className="mt-3 text-graphite">
            The vendor’s sealed invoice is shown beside the checks Symbolon can make for this business right now. Matched does not mean paid.
          </p>

          {/* Paid banner and receipt link (Fact 4 / Decision A11) */}
          {view.row.status === "paid" || view.row.credited > 0n ? (
            <Callout
              tone="ok"
              title={view.row.status === "paid" ? "Paid onchain" : "Partly settled onchain"}
              className="mt-5"
              actions={<Link href={`/receipt/${fingerprint}`} className={buttonClass({ variant: "secondary", size: "sm" })}>View the public receipt</Link>}
            >
              Settled against the Arc invoice ledger.
            </Callout>
          ) : null}

          {view.row.status === "awaiting_approval" ? (
            <Callout
              tone="info"
              title="Waiting for approval"
              className="mt-5"
              actions={<Link href="/business/approvals" className={buttonClass({ size: "sm" })}>Review in Approvals</Link>}
            >
              An owner or approver has to sign before this can be paid.
            </Callout>
          ) : null}

          {/* Evidence rows */}
          <ul className="mt-7 border-t border-ink">
            {view.evidence.rows.map((row) => (
              <li key={row.label} className="grid gap-1 border-b border-rule-soft py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                <span className="text-graphite">{row.label}</span>
                <span className={`min-w-0 break-words ${row.state === "blocks" ? "text-red" : row.state === "missing" ? "text-graphite" : "text-ink"}`}>
                  {row.value}
                  <span className="mt-1 block text-sm text-graphite">{row.source}</span>
                </span>
              </li>
            ))}
          </ul>

          <BusinessOffers businessId={where.business.id} fingerprint={fingerprint} view={offers} symbol={view.verification.document.currency.symbol} />
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

          {/* Latest Steward decision (A9) */}
          {latestDecision ? (
            <div className="mt-6 rounded-doc border border-rule bg-paper-raised px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Eyebrow as="span">Steward decision</Eyebrow>
                <Link href={`/business/decisions/${latestDecision.id}`} className="text-sm text-ink underline decoration-rule underline-offset-4 hover:text-seal">
                  Full record →
                </Link>
              </div>
              <p className="mt-2 font-medium text-ink">
                {summarizeDecision(latestDecision.record as Parameters<typeof summarizeDecision>[0]).sentence}
              </p>
              <p className="mt-1 text-sm text-graphite">Rule: {String((latestDecision.record as Record<string, unknown>).rule ?? "none recorded")}</p>
            </div>
          ) : null}

          {view.trust === "new_vendor" ? (
            <Callout tone="neutral" className="mt-5">
              This invoice is sealed, but the vendor still needs a first-contact verification before the business can trust the relationship.
            </Callout>
          ) : null}

          {view.holdSource === "human" ? (
            <Callout tone="danger" className="mt-5">
              <p>
                {rejectionReason
                  ? `This invoice is held because delivery was rejected: ${rejectionReason}`
                  : "A reviewer placed this invoice on hold."}
              </p>
              {where.business.role === "owner" ? (
                <ReleaseHoldButton businessId={where.business.id} fingerprint={fingerprint} />
              ) : (
                <p className="mt-1 text-graphite">Only an owner can release this hold.</p>
              )}
            </Callout>
          ) : view.holdSource === "steward" ? (
            <Callout tone="neutral" className="mt-5">The Steward is holding this invoice until it can be re-evaluated. You don’t need to do anything.</Callout>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
