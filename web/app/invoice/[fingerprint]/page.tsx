import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { QR } from "@/components/QR";
import { PrintButton } from "@/components/public/PrintButton";
import { PublicHeader } from "@/components/public/PublicHeader";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { loadPublicInvoice } from "@/lib/server/public-invoice";
import { showAmount, showDate } from "@/lib/format";
import { Address } from "@/components/Address";
import { buttonClass } from "@/components/ui/button";
import { Eyebrow, SectionTitle } from "@/components/ui/Type";
import { CONTAINER } from "@/components/shell/container";

export const dynamic = "force-dynamic";
// An invoice link is for the person it was sent to, not for search engines
export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Invoice" };

/** The public invoice link (P1): the sealed invoice, checked on every visit, with what Arc's ledger says about payment. No account needed. */
export default async function PublicInvoicePage({ params }: { params: Promise<{ fingerprint: string }> }) {
  const { fingerprint } = await params;
  const config = getConfig();
  const view = await loadPublicInvoice(await getDb(), getClient(), config, fingerprint);
  if (!view) notFound();

  if (view.state === "failed")
    return (
      <div className="min-h-screen">
        <PublicHeader />
        <main className="mx-auto max-w-[760px] px-6 pb-24 pt-14 md:px-10">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-red">Did not pass the check</p>
          <h1 className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] leading-[1.05]">This invoice can’t be shown as genuine.</h1>
          <p className="mt-4 text-graphite">It was checked just now and did not match its signature. Don’t pay from it. Ask the sender for a new link.</p>
          <ul className="mt-6 list-disc space-y-1 pl-5 text-sm">
            {view.issues.slice(0, 5).map((i, n) => (
              <li key={n}>{i.message}</li>
            ))}
          </ul>
        </main>
      </div>
    );

  const d = view.document;
  const link = `${config.appOrigin}/invoice/${view.fingerprint}`;
  const handle = view.seal.handle ?? "unregistered";
  const st = view.ledger.ok ? view.ledger.status : null;
  const payment = !view.ledger.ok
    ? { tone: "text-red", text: "Can’t read the ledger on Arc right now, so payment status isn’t shown. Try again in a moment." }
    : st!.cancelled
      ? { tone: "text-graphite", text: "The sender has cancelled this invoice." }
      : st!.paid
        ? { tone: "text-seal", text: "Paid in full, according to Arc’s ledger." }
        : st!.credited > 0n
          ? { tone: "text-seal", text: "Partly paid, according to Arc’s ledger." }
          : { tone: "text-graphite", text: "Not paid yet, according to Arc’s ledger." };

  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className={`${CONTAINER} pb-24 pt-12 print:pt-0`}>
        <Eyebrow>Invoice for {d.payer.name}</Eyebrow>
        <h1 className="mt-3 max-w-[20ch] font-display text-[clamp(2.2rem,5vw,3.8rem)] leading-[1.02] tracking-[-0.01em]">
          {d.vendor.name} sent you an invoice for <span className="whitespace-nowrap">{showAmount(d.total)} {d.currency.symbol}.</span>
        </h1>
        <p className="mt-4 text-graphite">Due {showDate(d.dueDate)}.</p>

        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <InvoiceDoc document={d} fingerprint={view.fingerprint} handle={handle} sealed />

          <section aria-labelledby="checks" className="space-y-6">
            <div>
              <SectionTitle id="checks">
                Checked just now
              </SectionTitle>
              <ul className="mt-3 space-y-2 text-sm">
                <li>
                  <span className="text-seal" aria-hidden>
                    ✓{" "}
                  </span>
                  Signed by the Seal <Address value={view.seal.address} full className="text-xs" />
                  {view.seal.handle ? <> (@{view.seal.handle})</> : null}. The signature matches the invoice exactly as written.
                </li>
                <li>
                  <span className="text-seal" aria-hidden>
                    ✓{" "}
                  </span>
                  The amounts add up, and it is sealed for Symbolon’s ledger on Arc.
                </li>
                <li className={payment.tone}>{payment.text}</li>
              </ul>
              <p className="mt-3 text-xs text-graphite">
                Anyone can check this on their own, without trusting this page: <a href="/verify" className="underline decoration-rule underline-offset-4">verify the file</a>.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 print:hidden">
              <a href={`/invoice/${view.fingerprint}/file`} className={buttonClass()}>
                Download the sealed file
              </a>
              <PrintButton />
            </div>

            <div className="flex items-center gap-4 border-t border-rule pt-5">
              <QR text={link} />
              <p className="min-w-0 flex-1 break-all text-xs text-graphite">
                This invoice’s link
                <span data-wrap-ok className="mt-1 block font-mono">{link}</span>
              </p>
            </div>
            <p className="text-xs text-graphite">Paying from this page isn’t available yet.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
