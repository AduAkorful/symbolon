import Link from "next/link";
import { SealStamp } from "@/components/Marks";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Act } from "@/components/Act";

const rows = [
  ["Invoice", "Studio Ana, No. 0143 (October retainer)"],
  ["Paid by", "Acme Operations’ Vault"],
  ["Invoice total", "2,000.00 USDC"],
  ["Early-payment discount", "0.75%, signed by Studio Ana"],
  ["Paid", "1,985.00 USDC"],
  ["When", "28 Sep 2026, 09:12, on Arc"],
  ["Transaction", "tx"],
  ["Invoice fingerprint", "0x3d9b0e17…c1e7f308"],
];

/** A shareable receipt (P3): everything needed to check the payment independently */
export default function Receipt() {
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-[760px] px-6 pb-24 pt-14 md:px-10">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">Receipt</p>
        <div className="mt-3 flex items-start justify-between gap-6">
          <h1 className="font-display text-[clamp(2.8rem,6vw,4.6rem)] leading-none">$1,985.00</h1>
          <SealStamp handle="@studio-ana" size={76} className="rotate-[-8deg]" />
        </div>
        <p className="mt-3 text-graphite">Paid to Studio Ana, 30 days before the due date.</p>
        <dl className="mt-10 border-t border-ink">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[13rem_1fr]">
              <dt className="text-graphite">{k}</dt>
              <dd className={k === "Invoice fingerprint" ? "font-mono text-sm" : ""}>{k === "Transaction" ? <TxLink hash={tx.payAna}>{tx.payAna}</TxLink> : v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/p/verify" className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
            Check it yourself
          </Link>
          <Act className="rounded-doc border border-rule px-4 py-2.5 text-sm hover:border-ink" copy="/p/receipt" done="Link copied">Copy link</Act>
          <Act className="rounded-doc border border-rule px-4 py-2.5 text-sm hover:border-ink" open="/p/invoice/pdf" done="PDF opened in a new tab">Download PDF</Act>
        </div>
        <p className="mt-6 text-sm text-graphite">Anyone with this receipt can confirm the payment on Arc; it doesn’t depend on Symbolon being online.</p>
      </main>
    </div>
  );
}
