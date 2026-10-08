import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { vendorRequests } from "@symbolon/db";
import { VendorRequestsSection } from "@/components/business/VendorRequestsSection";
import { AddPayee } from "@/components/inbox/AddPayee";
import { ManageVendorBlock } from "@/components/inbox/ManageVendorBlock";
import { VerifyVendor } from "@/components/inbox/VerifyVendor";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { AuthError } from "@/lib/server/errors";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { vendorDetail } from "@/lib/server/vendors";
import { listBudgets } from "@/lib/server/budgets";
import { PayeeTermsEditor } from "@/components/vendors/PayeeTermsEditor";
import { formatDay, formatDateTime, shortenAddressesIn, usd } from "@/lib/format";
import { Address } from "@/components/Address";
import { Eyebrow, PageTitle, SectionTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

const trustLabel = (status: string) => status === "pending_verification" ? "Sealed, new vendor" : status === "verified" ? "Verified" : status === "blocked" ? "Blocked" : status === "invited" ? "Invited" : status === "retired" ? "Retired" : status;
const verificationLabel = (status: string) => status === "open" ? "Callback code in progress" : status === "awaiting_second" ? "Awaiting second confirmation" : status === "verified" ? "Verified" : status === "cancelled" ? "Cancelled" : status === "expired" ? "Expired" : status;
const methodLabel = (method: string) => method === "code" ? "trusted callback code" : method === "invitation" ? "business invitation" : method;
const when = (date: Date) => formatDateTime(date);
const activeLabel = (activeAt: string) => {
  if (activeAt === "0" || BigInt(activeAt) <= BigInt(Math.floor(Date.now() / 1000))) return "Active now";
  const seconds = Number(activeAt);
  return Number.isSafeInteger(seconds) ? "Active from " + formatDateTime(new Date(seconds * 1000)) : "Active at timestamp " + activeAt;
};

export default async function BusinessVendorDetailPage({ params }: { params: Promise<{ seal: string }> }) {
  const session = await requirePageSession("/business/vendors");
  const where = await loadSpaces(session);
  const business = where.business;
  if (!business) notFound();
  const { seal } = await params;
  const config = getConfig();
  const db = await getDb();
  let vendor;
  try {
    vendor = await vendorDetail(db, getClient(), config.deployment, session.user, business.id, seal);
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) notFound();
    throw error;
  }
  const requests = await db
    .select()
    .from(vendorRequests)
    .where(and(eq(vendorRequests.businessId, business.id), eq(vendorRequests.seal, seal.toLowerCase())))
    .orderBy(desc(vendorRequests.createdAt));

  const isBlocked = vendor.status === "blocked";
  const mayVerify = business.role === "owner" || business.role === "approver";
  const signer = signerPlanFor(session, config);
  const budgetsData = await listBudgets(db, getClient(), config.deployment, session.user, business.id).catch(() => null);

  return <Shell where={where} current={{ kind: "business", id: business.id }}>
    <article>
      <Link href="/business/vendors" className="text-sm underline decoration-rule underline-offset-4">← Vendors</Link>
      <Eyebrow className="mt-8">{business.name} · Vendor record</Eyebrow>
      <PageTitle className="mt-2 break-words">{shortenAddressesIn(vendor.name)}</PageTitle>
      {vendor.handle ? <p className="mt-1 text-sm text-graphite">@{vendor.handle}</p> : null}
      <div className="mt-3 text-sm text-graphite"><Address value={vendor.seal} full copy /></div>

      <section className="mt-8 grid gap-6 border-y border-rule py-6 md:grid-cols-2">
        <div>
          <SectionTitle>Verification</SectionTitle>
          <p className="mt-2 text-sm">Relationship status: <span className="text-ink">{trustLabel(vendor.status)}</span></p>
          {vendor.verificationHistory.length ? <ol className="mt-4 space-y-4">
            {vendor.verificationHistory.map((record) => <li key={record.id} className="border-l-2 border-seal pl-3">
              <p className="text-sm">{verificationLabel(record.status)} · {methodLabel(record.method)}</p>
              <p className="mt-1 text-xs text-graphite">Raised by {record.raisedBy}{record.confirmedBy ? " · confirmed by " + record.confirmedBy : ""}{record.secondBy ? " · second person " + record.secondBy : ""}</p>
              {record.contacted || record.channel ? <p className="mt-1 text-xs text-graphite">Contacted {record.contacted ?? "not recorded"} · channel {record.channel ?? "not recorded"}</p> : null}
              <time className="mt-1 block text-xs text-graphite" dateTime={record.at.toISOString()}>{when(record.at)}</time>
            </li>)}
          </ol> : <p className="mt-3 text-sm text-graphite">No verification record yet.</p>}
          {mayVerify && vendor.status !== "verified" && !isBlocked && vendor.invoiceOnFile ? <>
            <h3 className="mt-5 text-sm font-medium">Available verification methods</h3>
            <div className="mt-2 rounded border border-rule p-3">
              <p className="text-sm">Trusted callback code</p>
              <p className="mt-1 text-xs text-graphite">Use a channel your business trusted before this invoice. Never use contact details from the invoice, its email, or the Seal profile.</p>
              <VerifyVendor businessId={business.id} seal={vendor.seal} verificationId={vendor.verification?.status === "open" ? vendor.verification.id : undefined} awaitingSecond={vendor.verification?.status === "awaiting_second"} />
            </div>
            <ul className="mt-3 space-y-3 text-xs text-graphite">
              <li><span className="font-medium text-ink">Invitation:</span> verification is recorded when a vendor accepts the business’s one-time invitation. For a vendor not yet linked, create that invitation from the vendor list.</li>
              <li><span className="font-medium text-ink">Records match — unavailable:</span> no trusted vendor-record import is connected yet; matching needs at least two independent records.</li>
              <li><span className="font-medium text-ink">Test payment — unavailable:</span> this workflow is not implemented here; a test payment can confirm an address, but cannot verify the business relationship.</li>
            </ul>
          </> : null}
        </div>

        <div>
          <SectionTitle>Vault payee activation</SectionTitle>
          <p className="mt-1 text-xs text-graphite">Activation is not a promise that an invoice will pass the Vault’s payment, policy, matching, and screening checks.</p>
          {!vendor.canBePaid.confirmed ? <p className="mt-2 text-sm text-red">Can't confirm the Vault record right now.</p> : vendor.canBePaid.exists ? <>
            <p className="mt-2 text-sm">{activeLabel(vendor.canBePaid.activeAt)}</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-graphite">Payout address · domain {vendor.canBePaid.payoutDomain}</dt><dd className="mt-1"><Address value={vendor.canBePaid.payout} full copy /></dd></div>
              <div><dt className="text-graphite">Monthly cap</dt><dd className="break-all">{usd(BigInt(vendor.canBePaid.terms.monthlyCap))} a month</dd></div>
              <div><dt className="text-graphite">Paid invoices</dt><dd>{vendor.canBePaid.paidCount}</dd></div>
              <div><dt className="text-graphite">Matching requirements</dt><dd>PO {vendor.canBePaid.terms.requirePo ? "required" : "not required"} · delivery {vendor.canBePaid.terms.requireDelivery ? "required" : "not required"}</dd></div>
              <div><dt className="text-graphite">Screening</dt><dd>{vendor.canBePaid.screening.risk}</dd></div>
            </dl>
            {business.role === "owner" && budgetsData ? (
              <PayeeTermsEditor
                accountingDecimals={budgetsData.accountingDecimals}
                businessId={business.id}
                seal={vendor.seal}
                currentTerms={{
                  budget: vendor.canBePaid.terms.budget,
                  requirePo: vendor.canBePaid.terms.requirePo,
                  requireDelivery: vendor.canBePaid.terms.requireDelivery,
                  monthlyCap: String(vendor.canBePaid.terms.monthlyCap),
                }}
                budgets={budgetsData.budgets.map((b) => ({ id: b.id, name: b.name }))}
                signer={signer}
                looseningDelaySeconds={86400}
              />
            ) : null}
          </> : <p className="mt-2 text-sm text-graphite">Not added to this Vault as a payee.</p>}
          {business.role === "owner" && !budgetsData ? <p className="mt-2 text-sm text-red">Can't load budget and amount settings. Payee terms cannot be edited until they are confirmed.</p> : null}
          {business.role === "owner" && vendor.status === "verified" && vendor.canBePaid.confirmed && !vendor.canBePaid.exists ? <AddPayee businessId={business.id} seal={vendor.seal} signer={signer} explorer={config.deployment.explorer} /> : null}
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>Invoices on file</SectionTitle>
        {vendor.invoices.length ? <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {vendor.invoices.map((invoice) => <li key={invoice.fingerprint} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <Link className="underline decoration-rule underline-offset-4" href={"/business/inbox/" + invoice.fingerprint}>{invoice.invoiceNumber}</Link>
            <span>{usd(BigInt(invoice.total))} · due {formatDay(invoice.dueDate)}</span>
          </li>)}
        </ul> : <p className="mt-3 text-sm text-graphite">No invoices on file for this business.</p>}
      </section>

      {/* Payout change requests */}
      <VendorRequestsSection
        businessId={business.id}
        seal={vendor.seal}
        isOwner={business.role === "owner"}
        isApprover={business.role === "approver"}
        requests={requests.map((r) => {
          const m = r.message as Record<string, unknown>;
          return {
            id: r.id,
            seal: r.seal,
            newPayout: String(m.newPayout ?? ""),
            payoutDomain: Number(m.payoutDomain ?? 0),
            nonce: String(m.nonce ?? ""),
            status: r.status as any,
            createdAt: r.createdAt.toISOString(),
          };
        })}
        pendingPayout={vendor.canBePaid.confirmed && vendor.canBePaid.exists ? (vendor.canBePaid as any).pendingPayout : undefined}
        pendingActiveAt={vendor.canBePaid.confirmed && vendor.canBePaid.exists && (vendor.canBePaid as any).pendingActiveAt ? Number((vendor.canBePaid as any).pendingActiveAt) : undefined}
        signer={signer}
      />

      <section className="mt-8 border-t border-rule pt-6">
        <SectionTitle>Relationship controls</SectionTitle>
        {business.role === "owner" || business.role === "approver" ? <div className="mt-3"><ManageVendorBlock businessId={business.id} seal={vendor.seal} blocked={isBlocked} canUnblock={business.role === "owner"} /></div> : <p className="mt-3 text-sm text-graphite">An owner or approver manages the blocked state.</p>}
      </section>
    </article>
  </Shell>;
}
