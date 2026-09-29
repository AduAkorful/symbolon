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

export const dynamic = "force-dynamic";
const trustLabel = (status: string) => status === "pending_verification" ? "Sealed, new vendor" : status === "verified" ? "Verified" : status === "blocked" ? "Blocked" : status === "invited" ? "Invited" : status === "awaiting_second" ? "Awaiting second confirmation" : status === "open" ? "Callback code in progress" : status === "expired" ? "Expired" : status === "cancelled" ? "Cancelled" : status === "retired" ? "Retired" : status;
const methodLabel = (method: string) => method === "code" ? "trusted callback code" : method === "invitation" ? "business invitation" : method;

export default async function BusinessVendorsPage() {
  const session = await requirePageSession("/b/vendors");
  const where = await loadSpaces(session);
  const business = where.business;
  if (!business) return <Shell where={where} current={{ kind: "business", id: "" }}><h1 className="font-display text-4xl">No business yet</h1></Shell>;
  const data = await listVendors(await getDb(), getClient(), getConfig().deployment, session.user, business.id);
  const config = getConfig();
  const signer = signerPlanFor(session, config);
  const explorer = config.deployment.explorer;
  return <Shell where={where} current={{ kind: "business", id: business.id }}>
    <div className="max-w-[900px]">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">{business.name}</p>
      <h1 className="mt-2 font-display text-4xl">Vendors</h1>
      <p className="mt-3 max-w-[64ch] text-graphite">Verification is your first-contact record. Vault payee activation is a separate onchain fact; it does not mean an invoice will pass every payment check.</p>
      {business.role === "owner" ? <section className="mt-8 border-y border-rule py-5"><h2 className="font-display text-2xl">Invite a vendor</h2><InviteVendor businessId={business.id} /></section> : null}
      <h2 className="mt-10 font-display text-2xl">Relationships</h2>
      {data.vendors.length ? <ul className="mt-4 divide-y divide-rule border-y border-rule">{data.vendors.map((v) => <li key={v.seal} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto]">
        <div><p className="font-medium"><Link href={"/b/vendors/" + v.seal} className="underline decoration-rule underline-offset-4">{v.name}</Link>{v.handle ? <span className="ml-2 font-mono text-xs text-graphite">@{v.handle}</span> : null}</p><p className="mt-1 break-all font-mono text-[11px] text-graphite">{v.seal}</p>
          <p className="mt-2 text-sm">Verification: <span>{trustLabel(v.verification?.status ?? v.status)}</span>{v.verification?.method ? ` · ${methodLabel(v.verification.method)}` : ""}</p>
          {(business.role === "owner" || business.role === "approver") && v.status !== "blocked" ? v.verification?.status === "awaiting_second" ? <VerifyVendor businessId={business.id} seal={v.seal} verificationId={v.verification.id} awaitingSecond /> : v.status !== "verified" && v.invoiceOnFile ? <VerifyVendor businessId={business.id} seal={v.seal} verificationId={v.verification?.status === "open" ? v.verification.id : undefined} /> : null : null}
          {business.role === "owner" && v.status === "verified" && v.canBePaid.confirmed && !v.canBePaid.exists ? <AddPayee businessId={business.id} seal={v.seal} signer={signer} explorer={explorer} /> : null}
        </div>
        <div className="text-sm sm:text-right"><p>Vault payee activation: {v.canBePaid.confirmed ? v.canBePaid.exists ? v.canBePaid.activeAt === "0" || BigInt(v.canBePaid.activeAt) <= BigInt(Math.floor(Date.now() / 1000)) ? "active" : `starts ${new Date(Number(v.canBePaid.activeAt) * 1000).toLocaleDateString()}` : "not added" : "can't confirm"}</p><p className="mt-1 break-all text-xs text-graphite">{v.canBePaid.confirmed && v.canBePaid.exists ? `Paid ${v.canBePaid.paidCount} invoices · cap ${v.canBePaid.terms.monthlyCap} raw units · PO ${v.canBePaid.terms.requirePo ? "required" : "not required"} · delivery ${v.canBePaid.terms.requireDelivery ? "required" : "not required"}` : v.invoiceOnFile ? "Invoice on file" : "No invoice yet"}</p>{v.canBePaid.confirmed && v.canBePaid.exists ? <p className="mt-1 text-xs text-graphite">Screening: {v.canBePaid.screening.risk}{v.canBePaid.screening.at !== "0" ? ` · block ${v.blockNumber}` : ""}</p> : null}</div>
      </li>)}</ul> : <p className="mt-4 border-y border-rule py-6 text-graphite">No linked vendors yet.</p>}
      {data.invitations.length ? <section className="mt-10"><h2 className="font-display text-2xl">Open invitations</h2><ul className="mt-3 divide-y divide-rule border-y border-rule">{data.invitations.map((i) => <li key={i.id} className="py-3"><p>{i.vendorName}</p><p className="mt-1 text-xs text-graphite">Contact note (business only): {i.contactNote} · expires {i.expiresAt.toLocaleDateString()}</p><p className="mt-1 text-xs">The secret link was shown once when created; it is not recoverable here.</p>{business.role === "owner" ? <div className="mt-2"><RevokeInvitation businessId={business.id} invitationId={i.id} /></div> : null}</li>)}</ul></section> : null}
      <p className="mt-8 text-sm"><Link href="/b/inbox" className="underline">Back to inbox</Link></p>
    </div>
  </Shell>;
}
