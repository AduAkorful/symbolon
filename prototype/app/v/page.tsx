import Link from "next/link";
import { Reveal } from "@/components/app/Reveal";
import { Money } from "@/components/Money";
import { VStatusTag } from "@/components/vendor/VStatusTag";
import { clients, vInvoices } from "@/lib/ana";

export default function VendorHome() {
  const open = vInvoices.filter((i) => i.status !== "paid" && i.status !== "cancelled");
  return (
    <Reveal>
      <main className="px-6 pb-24 pt-10 md:px-10">
        <p data-reveal className="text-sm text-graphite">Studio Ana</p>
        <h1 data-reveal className="mt-1 font-display text-5xl">
          Good morning.
        </h1>

        <dl data-reveal className="mt-10 grid grid-cols-2 gap-x-10 gap-y-8 border-y border-rule py-8 md:grid-cols-4">
          {[
            ["Outstanding", "$7,250.00", "3 invoices"],
            ["Expected this week", "$1,650.00", "Kite & Co, due 2 Oct"],
            ["Paid this month", "$3,785.00", "2 invoices"],
            ["Days to paid", "1 day", "Acme, on average"],
          ].map(([k, v, n]) => (
            <div key={k}>
              <dt className="text-sm text-graphite">{k}</dt>
              <dd className="mt-1 font-display text-4xl leading-none">{v}</dd>
              <dd className="mt-1 text-xs text-graphite">{n}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section aria-labelledby="open">
            <div data-reveal className="flex items-baseline justify-between">
              <h2 id="open" className="font-display text-3xl">
                Waiting to be paid
              </h2>
              <Link href="/v/invoices" className="text-sm text-graphite underline decoration-rule underline-offset-4">
                All invoices
              </Link>
            </div>
            <ul className="mt-5 border-t border-ink">
              {open.map((i) => (
                <li key={i.id} data-reveal className="border-b border-rule">
                  <Link href={`/v/invoices/${i.id}`} className="grid grid-cols-[1fr_auto] gap-x-4 py-4 hover:bg-rule-soft/40">
                    <span>
                      <span className="font-medium">{i.client}</span> <span className="font-mono text-xs text-graphite">{i.number}</span>
                      <span className="block text-sm text-graphite">{i.note}</span>
                    </span>
                    <span className="text-right">
                      <Money raw={i.amount} symbol="$" precise={false} />
                      <span className="block">
                        <VStatusTag status={i.status} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div data-reveal className="mt-6 rounded-doc border border-seal/40 bg-paper-raised p-5">
              <p className="font-medium">Need cash sooner?</p>
              <p className="mt-1 text-sm text-graphite">
                Acme’s invoice 0142 is due 28 Oct. Offer a small discount and Acme’s Steward can pay you today.
              </p>
              <Link href="/v/invoices/0142/early" className="mt-3 inline-block rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
                Get paid today
              </Link>
            </div>
          </section>

          <section aria-labelledby="clients">
            <h2 id="clients" data-reveal className="font-display text-3xl">
              Clients
            </h2>
            <ul className="mt-5 border-t border-ink">
              {clients.map((c) => (
                <li key={c.name} data-reveal className="grid grid-cols-[1fr_auto] gap-4 border-b border-rule py-3.5 text-sm">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="block text-graphite">{c.on ? "On Symbolon" : "Invited"}</span>
                  </span>
                  <span className="text-right">
                    {c.paid}
                    <span className="block text-graphite">{c.avgDays === "—" ? "—" : `${c.avgDays} to paid`}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Link data-reveal href="/v/clients" className="mt-3 inline-block text-sm text-graphite underline decoration-rule underline-offset-4">
              Invite a client
            </Link>
          </section>
        </div>
      </main>
    </Reveal>
  );
}
