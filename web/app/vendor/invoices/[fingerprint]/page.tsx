import { notFound } from "next/navigation";
import Link from "next/link";
import { CancelInvoiceAction } from "@/components/vendor/CancelInvoiceAction";
import { CopyLink } from "@/components/vendor/CopyLink";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { Shell } from "@/components/shell/Shell";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { myInvoice } from "@/lib/server/invoice-send";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { requireVendorPage } from "@/lib/server/vendor-page";
import { toneClass, vendorStatus } from "@/lib/invoice-status";

export const dynamic = "force-dynamic";

/** One of the vendor's own invoices: the sealed document, its status and the link to send. */
export default async function VendorInvoice({ params }: { params: Promise<{ fingerprint: string }> }) {
  const { fingerprint } = await params;
  const { session, seal, where } = await requireVendorPage(`/vendor/invoices/${fingerprint}`);
  const config = getConfig();
  const signer = signerPlanFor(session, config);
  const found = await myInvoice(await getDb(), session.user, fingerprint);
  if (!found) notFound();
  const st = vendorStatus(found.row.status);
  const link = `${config.appOrigin}/invoice/${found.row.fingerprint}`;
  const isSettled = found.row.status === "paid" || found.row.credited > 0n;
  const isCancelled = found.row.status === "cancelled";

  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <InvoiceDoc document={found.sealed.document} fingerprint={found.row.fingerprint} handle={seal.handle} sealed={found.row.status !== "rejected"} />
        <section className="lg:pt-6">
          <p className={`font-mono text-xs uppercase tracking-[0.16em] ${toneClass[st.tone]}`}>{st.label}</p>
          <h1 className="mt-2 font-display text-4xl leading-none">Invoice {found.row.invoiceNumber}</h1>
          <p className="mt-3 max-w-[52ch] text-graphite">To {found.sealed.document.payer.name}. Send them this link; anyone who has it can open the invoice and check it.</p>
          {found.sealed.document.replaces ? (
            <p className="mt-2 text-xs font-mono text-seal">
              Replaces invoice {found.sealed.document.replaces.slice(0, 10)}… (original cancels when settled)
            </p>
          ) : null}
          <CopyLink link={link} />

          {/* Early pay and cancel actions for unpaid invoices */}
          {!isSettled && !isCancelled ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={`/vendor/invoices/${found.row.fingerprint}/early`}
                className="rounded-doc bg-ink px-4 py-2 text-xs font-medium text-paper hover:opacity-90"
              >
                Get paid early →
              </Link>
              <CancelInvoiceAction
                fingerprint={found.row.fingerprint}
                invoiceNumber={found.row.invoiceNumber}
                signer={signer}
              />
            </div>
          ) : null}

          {/* Public receipt link if settled onchain (Fact 4 / Decision A11 / A12) */}
          {isSettled ? (
            <div className="mt-6 rounded-doc border border-seal/40 bg-seal/5 p-4 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs uppercase tracking-wider text-seal font-medium">
                    {found.row.status === "paid" ? "Settled onchain" : "Partially settled"}
                  </span>
                  <p className="mt-0.5 text-xs text-graphite">Recorded on the Arc InvoiceLedger</p>
                </div>
                <Link
                  href={`/receipt/${found.row.fingerprint}`}
                  className="font-medium text-seal underline decoration-seal/40 underline-offset-4 hover:text-ink"
                >
                  View receipt →
                </Link>
              </div>
            </div>
          ) : null}

          {/* Factual timeline (Decision A12: ledger and creation facts only) */}
          <div className="mt-8 border-t border-ink pt-6">
            <h2 className="font-mono text-xs uppercase tracking-wider text-graphite">Timeline</h2>
            <ol className="mt-4 space-y-4 text-xs">
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-seal flex-shrink-0" />
                <div>
                  <p className="font-medium text-ink">Sealed with vendor key</p>
                  <p className="text-graphite">{found.row.receivedAt.toISOString().slice(0, 10)}</p>
                </div>
              </li>
              {found.row.businessId ? (
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-seal flex-shrink-0" />
                  <div>
                    <p className="font-medium text-ink">Received by payer</p>
                    <p className="text-graphite">Matched to {found.sealed.document.payer.name}</p>
                  </div>
                </li>
              ) : null}
              {found.row.status === "paid" ? (
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-seal flex-shrink-0" />
                  <div>
                    <p className="font-medium text-ink">Settled onchain</p>
                    <p className="text-graphite">Payment delivered to payout address</p>
                  </div>
                </li>
              ) : found.row.status === "cancelled" ? (
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-red flex-shrink-0" />
                  <div>
                    <p className="font-medium text-red">Cancelled onchain</p>
                    <p className="text-graphite">Replacement or credit note registered</p>
                  </div>
                </li>
              ) : (
                <li className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-rule flex-shrink-0" />
                  <div>
                    <p className="font-medium text-graphite">Settlement pending</p>
                    <p className="text-graphite">Awaiting payer Vault release</p>
                  </div>
                </li>
              )}
            </ol>
          </div>
        </section>
      </div>
    </Shell>
  );
}
