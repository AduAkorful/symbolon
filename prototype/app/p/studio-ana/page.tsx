import Link from "next/link";
import { SealStamp } from "@/components/Marks";
import { PublicHeader } from "@/components/public/PublicHeader";

const record = [
  ["Invoices paid through Symbolon", "11"],
  ["Paid on or before the due date", "11 of 11"],
  ["Businesses that have paid", "2"],
  ["Disputes", "None"],
  ["Credit notes issued", "1"],
  ["Sealing since", "Sep 2026"],
];

/** A vendor's public profile (P4): identity and a record built only from what happened */
export default function Profile() {
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-[980px] px-6 pb-24 pt-14 md:px-10">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div>
            <p className="font-mono text-sm text-graphite">symbolon.xyz/@studio-ana</p>
            <h1 className="mt-2 font-display text-[clamp(3rem,6vw,4.8rem)] leading-none">Studio Ana</h1>
            <p className="mt-3 text-graphite">Brand identity and design systems · Lisbon</p>
            <ul className="mt-5 flex flex-wrap gap-2 text-sm">
              <li className="rounded-full border border-seal/50 px-3 py-1 text-seal">✓ studio-ana.com verified</li>
              <li className="rounded-full border border-rule px-3 py-1">Paid in USDC on Arc</li>
            </ul>
          </div>
          <SealStamp handle="@studio-ana" size={120} className="rotate-[-8deg]" />
        </div>

        <section aria-labelledby="record" className="mt-14">
          <h2 id="record" className="font-display text-3xl">
            The record
          </h2>
          <p className="mt-1 text-sm text-graphite">Built only from payments and documents on Symbolon, shown with Studio Ana’s consent. Nothing here is self-written.</p>
          <dl className="mt-5 grid border-t border-ink sm:grid-cols-2 sm:gap-x-10">
            {record.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 border-b border-rule py-3.5">
                <dt className="text-graphite">{k}</dt>
                <dd className="text-lg font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-10 rounded-doc border border-rule bg-paper-raised p-6">
          <p className="font-medium">Paying Studio Ana for the first time?</p>
          <p className="mt-1 text-sm text-graphite">
            A verified domain is a good sign, but confirm the studio once through a channel you already use before your first payment.
            This profile vouches for identity, not for you.
          </p>
          <Link href="/p/verify" className="mt-4 inline-block rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
            Verify an invoice from Studio Ana
          </Link>
        </div>
      </main>
    </div>
  );
}
