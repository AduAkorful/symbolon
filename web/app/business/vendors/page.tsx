import Link from "next/link";
import { InviteVendor } from "@/components/inbox/InviteVendor";
import { AddPayee } from "@/components/inbox/AddPayee";
import { VerifyVendor } from "@/components/inbox/VerifyVendor";
import { RevokeInvitation } from "@/components/inbox/RevokeInvitation";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { listVendors } from "@/lib/server/vendors";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { formatDay, shortenAddressesIn, usd } from "@/lib/format";
import { Address } from "@/components/Address";
import { EmptyState } from "@/components/ui/States";
import { StatusPill, type Tone } from "@/components/ui/StatusPill";
import { Lead, PageTitle, SectionTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";
const trustLabel = (status: string) => status === "pending_verification" ? "Sealed, new vendor" : status === "verified" ? "Verified" : status === "blocked" ? "Blocked" : status === "invited" ? "Invited" : status === "awaiting_second" ? "Awaiting second confirmation" : status === "open" ? "Callback code in progress" : status === "expired" ? "Expired" : status === "cancelled" ? "Cancelled" : status === "retired" ? "Retired" : status;
const verificationTone = (status: string): Tone => status === "verified" ? "ok" : status === "blocked" || status === "expired" ? "danger" : status === "awaiting_second" || status === "open" || status === "pending_verification" ? "warn" : "neutral";
const methodLabel = (method: string) => method === "code" ? "trusted callback code" : method === "invitation" ? "business invitation" : method;

export default async function BusinessVendorsPage() {
  const session = await requirePageSession("/business/vendors");
  const where = await loadSpaces(session);
  const business = where.business;
  if (!business) return <Shell where={where} current={{ kind: "business", id: "" }}><PageTitle>No business yet</PageTitle></Shell>;
  const data = await listVendors(await getDb(), getClient(), getConfig().deployment, session.user, business.id);
  const config = getConfig();
  const signer = signerPlanFor(session, config);
  const explorer = config.deployment.explorer;
  const canVerify = business.role === "owner" || business.role === "approver";
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  return (
    <Shell where={where} current={{ kind: "business", id: business.id }}>
      <div>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <PageTitle>Vendors</PageTitle>
            <Lead className="mt-3">
              Verification is your record of first contact. Becoming a payee is a separate onchain step in your Vault; it doesn’t mean an invoice will pass every payment check.
            </Lead>
          </div>
          {business.role === "owner" ? <InviteVendor businessId={business.id} /> : null}
        </div>

        <SectionTitle className="mt-12">Relationships</SectionTitle>
        {data.vendors.length ? (
          <ul className="mt-4 divide-y divide-rule-soft border-y border-rule">
            {data.vendors.map((v) => {
              const payee = v.canBePaid;
              const active = payee.confirmed && payee.exists && (payee.activeAt === "0" || BigInt(payee.activeAt) <= nowSec);
              const verification = v.verification?.status ?? v.status;
              return (
                <li key={v.seal} className="grid gap-x-8 gap-y-3 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <Link href={"/business/vendors/" + v.seal} className="break-words font-medium text-ink underline decoration-rule underline-offset-4 hover:decoration-ink">{shortenAddressesIn(v.name)}</Link>
                      {v.handle ? <span className="text-sm text-graphite">@{v.handle}</span> : null}
                    </p>
                    <div className="mt-1 text-sm text-graphite"><Address value={v.seal} full copy /></div>
                    <p className="mt-3 flex flex-wrap items-center gap-2">
                      <StatusPill tone={verificationTone(verification)}>{trustLabel(verification)}</StatusPill>
                      {v.verification?.method ? <span className="text-sm text-graphite">via {methodLabel(v.verification.method)}</span> : null}
                    </p>
                    {canVerify && v.status !== "blocked" ? (
                      v.verification?.status === "awaiting_second" ? (
                        <VerifyVendor businessId={business.id} seal={v.seal} verificationId={v.verification.id} awaitingSecond />
                      ) : v.status !== "verified" && v.invoiceOnFile ? (
                        <VerifyVendor businessId={business.id} seal={v.seal} verificationId={v.verification?.status === "open" ? v.verification.id : undefined} />
                      ) : null
                    ) : null}
                    {business.role === "owner" && v.status === "verified" && payee.confirmed && !payee.exists ? (
                      <AddPayee businessId={business.id} seal={v.seal} signer={signer} explorer={explorer} />
                    ) : null}
                  </div>
                  <div className="min-w-0 text-sm lg:text-right">
                    <p className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <span className="text-graphite">In your Vault:</span>
                      <StatusPill tone={!payee.confirmed ? "warn" : active ? "ok" : payee.exists ? "info" : "neutral"}>
                        {!payee.confirmed ? "Can’t confirm" : !payee.exists ? "Not added" : active ? "Active payee" : `Starts ${formatDay(new Date(Number(payee.activeAt) * 1000))}`}
                      </StatusPill>
                    </p>
                    <p className="mt-2 text-graphite">
                      {payee.confirmed && payee.exists
                        ? `Paid ${payee.paidCount} ${payee.paidCount === 1 ? "invoice" : "invoices"} · ${usd(BigInt(payee.terms.monthlyCap))} a month · PO ${payee.terms.requirePo ? "required" : "not required"} · delivery ${payee.terms.requireDelivery ? "required" : "not required"}`
                        : v.invoiceOnFile ? "An invoice is on file" : "No invoice yet"}
                    </p>
                    {payee.confirmed && payee.exists ? <p className="mt-1 text-graphite">Screening: {payee.screening.risk}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="No vendors yet" className="mt-4">Invite a vendor, or add a sealed invoice to the inbox, and they appear here.</EmptyState>
        )}

        {data.invitations.length ? (
          <section className="mt-12">
            <SectionTitle>Open invitations</SectionTitle>
            <ul className="mt-4 divide-y divide-rule-soft border-y border-rule">
              {data.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{i.vendorName}</p>
                    <p className="mt-1 text-sm text-graphite">How you know them: {i.contactNote} · expires {formatDay(i.expiresAt)}</p>
                    <p className="mt-1 text-sm text-graphite">The secret link was shown once, when it was created, and can’t be recovered.</p>
                  </div>
                  {business.role === "owner" ? <RevokeInvitation businessId={business.id} invitationId={i.id} /> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
