import Link from "next/link";
import { ForecastChart, type ForecastEvent } from "@/components/ForecastChart";
import { Money } from "@/components/Money";
import { ReleaseNudge } from "./ReleaseNudge";
import { decisions, invoices } from "@/lib/acme";
import { vault } from "@/lib/demo";

// Operating balance, thousands of USDC, from 38.3 today (28 Sep). Forge Supply's 14.0 bill on 13 Oct would take it
// below the 20.0 buffer, so the Steward redeems 8.0 from reserve two days ahead.
const forecastEvents: ForecastEvent[] = [
  { day: 2, delta: -3.1, label: "Cloudline and 2 more", kind: "bill" },
  { day: 9, delta: -4.1, label: "Halden Freight", kind: "bill" },
  { day: 13, delta: 8.0, label: "Redeemed from reserve", kind: "redeem" },
  { day: 15, delta: -14.0, label: "Forge Supply F-778", kind: "bill" },
  { day: 24, delta: -2.6, label: "Kestrel Labs", kind: "bill" },
  { day: 30, delta: -2.4, label: "Studio Ana 0142", kind: "bill" },
];
const forecastDates = [
  { day: 0, label: "28 Sep" },
  { day: 7, label: "5 Oct" },
  { day: 14, label: "12 Oct" },
  { day: 21, label: "19 Oct" },
  { day: 28, label: "26 Oct" },
  { day: 35, label: "2 Nov" },
];

const ledger = [
  { id: "d-0912", time: "09:12", text: "Paid Studio Ana, retainer 0143, 30 days early", amount: "1985.000000", mark: "seal", note: "0.75% off" },
  { id: "d-0913", time: "09:13", text: "A retry of 0143, refused by the Vault", amount: null, mark: "red", note: "Already paid" },
  { id: "d-0940", time: "09:40", text: "Held Forge Supply F-778: delivery not confirmed", amount: null, mark: "red", note: "Waiting" },
  { id: "d-1005", time: "10:05", text: "Refused an unsealed email claiming to be Studio Ana", amount: null, mark: "red", note: "Not payable" },
  { id: "d-1131", time: "11:31", text: "Moved idle cash into the reserve", amount: "22000.000000", mark: "ink", note: "After a $40,000.00 deposit" },
];

/** Acme's Vault on an ordinary morning (B4). `linked` turns cards and entries into links (the live app). */
export function HomeView({ linked = true }: { linked?: boolean }) {
  const needs = invoices.filter((i) => i.id === "northwind-2291" || i.id === "forge-f778");
  const Wrap = ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    linked ? (
      <Link href={href} className={className}>
        {children}
      </Link>
    ) : (
      <div className={className}>{children}</div>
    );
  return (
    <main className="px-6 pb-20 pt-10 md:px-10">
      <ReleaseNudge />
      <section data-reveal className="grid gap-8 border-b border-rule pb-10 xl:grid-cols-[1fr_auto] xl:items-end">
        <div>
          <p className="text-sm text-graphite">Acme’s Vault holds</p>
          <p className="mt-2 font-display text-[clamp(3rem,7vw,5.6rem)] leading-[0.95] tracking-[-0.02em]">
            <Money raw="60320.000000" symbol="$" precise={false} />
          </p>
          <p className="mt-2 text-sm text-graphite">Dollars across operating and reserve, plus €2,100.00</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-10 gap-y-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-graphite">Operating</dt>
            <dd className="mt-1 text-base font-medium">
              <Money raw={vault.operating} symbol="$" precise={false} />
            </dd>
          </div>
          <div>
            <dt className="text-graphite">Euro balance</dt>
            <dd className="mt-1 text-base font-medium">
              <Money raw={vault.eurc} symbol="€" precise={false} />
            </dd>
          </div>
          <div>
            <dt className="text-graphite">Reserve</dt>
            <dd className="mt-1 text-base font-medium">
              <Money raw={vault.reserve} symbol="$" precise={false} />
              <span className="ml-1.5 text-[0.62em] font-medium tracking-wide text-graphite">in USYC</span>
            </dd>
          </div>
          <div>
            <dt className="text-graphite">Runway</dt>
            <dd className="mt-1 text-base font-medium">{vault.runwayDays} days</dd>
          </div>
        </dl>
      </section>

      <div className="mt-10 grid gap-12 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section aria-labelledby="needs">
          <h2 id="needs" data-reveal className="flex items-baseline gap-3 font-display text-3xl">
            Needs you <span className="font-sans text-base text-graphite">{needs.length}</span>
          </h2>
          <ul className="mt-5 space-y-4">
            {needs.map((n) => (
              <li key={n.id} data-reveal>
                <Wrap
                  href={n.status === "awaiting_approval" ? "/b/approvals" : `/b/inbox/${n.id}`}
                  className="block rounded-doc border border-rule bg-paper-raised p-5 transition-colors duration-[var(--dur-quick)] hover:border-ink/40"
                >
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className={`font-mono uppercase tracking-[0.14em] ${n.status === "held" ? "text-red" : "text-seal"}`}>
                      {n.status === "held" ? "Held" : "Early Pay request"}
                    </span>
                    <span className="text-graphite">{n.vendor}</span>
                  </div>
                  <p className="mt-2 text-lg font-medium leading-snug">
                    {n.status === "held" ? "Hardware invoice waiting for delivery" : "Wants to be paid today for 1.2% off"}
                  </p>
                  <p className="mt-1 text-sm text-graphite">
                    Invoice {n.number} · <Money raw={n.amount} symbol="$" precise={false} />
                    {n.status === "held" ? ` · due ${n.due}` : " due in 25 days → $8,892.00 now"}
                  </p>
                  <div className="mt-4 border-l-2 border-seal pl-3 text-sm">
                    <p className="text-xs uppercase tracking-[0.12em] text-graphite">Steward</p>
                    <p className="mt-1">{n.steward.says}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rule-soft pt-3">
                    <p className="text-xs text-graphite">{n.steward.rule}</p>
                    <span className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
                      {n.status === "held" ? "Open" : "Review and sign"}
                    </span>
                  </div>
                </Wrap>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="today">
          <h2 id="today" data-reveal className="font-display text-3xl">
            Steward’s ledger, today
          </h2>
          <ol className="mt-5 border-t border-ink">
            {ledger.map((e) => (
              <li key={e.id} data-reveal className="border-b border-rule">
                <Wrap href={`/b/decisions/${e.id}`} className="grid grid-cols-[3.2rem_1fr_auto] items-baseline gap-3 py-3 text-sm hover:bg-rule-soft/40">
                  <span className="font-mono text-xs text-graphite">{e.time}</span>
                  <span>
                    <span
                      className={`mr-2 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full ${
                        e.mark === "seal" ? "bg-seal" : e.mark === "red" ? "bg-red" : "bg-ink/40"
                      }`}
                    />
                    {e.text}
                    <span className={`ml-2 text-xs ${e.mark === "red" ? "text-red" : "text-graphite"}`}>{e.note}</span>
                  </span>
                  <span className="text-right">
                    {e.amount ? <Money raw={e.amount} symbol="$" precise={false} tabular /> : <span className="text-graphite">—</span>}
                  </span>
                </Wrap>
              </li>
            ))}
          </ol>
          <Wrap href="/b/activity" className="mt-3 inline-block text-sm text-graphite underline decoration-rule underline-offset-4">
            Every decision, with its reasons ({decisions.length} today)
          </Wrap>
        </section>
      </div>

      <section aria-labelledby="ahead" data-reveal className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="ahead" className="font-display text-3xl">
            The next five weeks
          </h2>
          <p className="text-sm text-graphite">Operating balance in thousands of dollars · the buffer holds 30 days of bills</p>
        </div>
        <ForecastChart start={38.3} days={35} buffer={20} events={forecastEvents} dates={forecastDates} />
      </section>
    </main>
  );
}
