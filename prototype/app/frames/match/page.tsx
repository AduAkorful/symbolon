import { Half } from "@/components/Chirograph";
import { DemoTag, SealStamp, Wordmark } from "@/components/Marks";
import { Money } from "@/components/Money";
import { retainer, vendor } from "@/lib/demo";

const checks = [
  { rule: "Sealed by Studio Ana", detail: "Verified for Acme since 12 Sep" },
  { rule: "Matches PO-0031", detail: "Design retainer, 2,000.00 a month, nothing invoiced yet in October" },
  { rule: "Delivery confirmed", detail: "October sign-off in Linear, by Dele on 30 Sep" },
  { rule: "Within the auto-pay limit", detail: "2,000.00 of 2,500.00 for verified vendors" },
  { rule: "Within the Design budget", detail: "6,000.00 left this month" },
  { rule: "Never paid before", detail: "This fingerprint has no payments" },
  { rule: "Worth paying early", detail: "0.75% for 30 days early is 9.1% a year, above 3.2% in reserve plus 3 points" },
];

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule-soft py-2.5 text-sm">
      <span className="text-graphite">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

export default function MatchFrame() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1240px] items-center justify-between px-6 pt-7 md:px-10">
        <Wordmark />
        <DemoTag />
      </header>

      <main className="mx-auto grid max-w-[1240px] gap-14 px-6 pb-24 pt-12 md:px-10 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section aria-label="The two halves">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Retainer 0143 · October</p>

          <div className="relative mt-6 flex drop-shadow-[0_18px_30px_rgba(21,33,28,0.12)]">
            {/* The vendor's half */}
            <Half side="vendor" fingerprint={retainer.fingerprint} className="w-1/2 bg-paper-raised" tone="var(--seal)" seamClassName="text-seal/30">
              <div className="px-6 py-7 pr-12">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">Invoice</p>
                <p className="mt-2 font-display text-2xl leading-none">{vendor.name}</p>
                <SealStamp handle={vendor.handle} size={58} className="mt-4 rotate-[-6deg]" />
                <div className="mt-5">
                  <Row k="No." v={retainer.number} />
                  <Row k="For" v="Design retainer, October" />
                  <Row k="PO" v={retainer.po} />
                  <Row k="Early Pay" v="0.75% within 15 days" />
                  <Row k="Total" v={<Money raw={retainer.amount} precise={false} />} />
                </div>
              </div>
            </Half>
            {/* Acme's half, closed against it: the edges fit because they were cut from the same fingerprint */}
            <Half
              side="payer"
              fingerprint={retainer.fingerprint}
              className="-ml-[22px] w-[calc(50%+22px)] bg-paper-raised"
              tone="var(--seal)"
              seamClassName="text-seal/30"
            >
              <div className="px-6 py-7 pl-12">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">Order and delivery</p>
                <p className="mt-2 font-display text-2xl leading-none">Acme Operations</p>
                <p className="mt-4 h-[58px] text-sm leading-snug text-graphite">Raised by Dele, Design. Delivery signed off in Linear.</p>
                <div className="mt-5">
                  <Row k="PO" v={retainer.po} />
                  <Row k="Kind" v="Retainer, monthly" />
                  <Row k="Cap" v={<Money raw={retainer.poCap} precise={false} />} />
                  <Row k="Delivered" v="30 Sep" />
                  <Row k="Budget" v="Design" />
                </div>
              </div>
            </Half>

            {/* The match stamp, struck across the seam */}
            <div className="pointer-events-none absolute left-1/2 top-[33%] -translate-x-1/2 -translate-y-1/2 rotate-[-9deg] rounded-sm border-2 border-seal bg-paper-raised/85 px-4 py-1.5 font-mono text-sm font-semibold uppercase tracking-[0.3em] text-seal">
              Matched
            </div>
          </div>

          <p className="mt-5 max-w-[52ch] text-sm text-graphite">
            Both halves were cut from the invoice’s fingerprint. Only the true pair fits, and the letters across the cut line up.
          </p>
        </section>

        <section aria-labelledby="result" className="xl:pt-9">
          <p className="text-sm text-graphite">Steward, 09:12</p>
          <h1 id="result" className="mt-2 font-display text-[clamp(2.6rem,4.6vw,3.8rem)] leading-[0.98]">
            Paid <Money raw={retainer.paid} precise={false} /> <span className="text-[0.5em] text-graphite">USDC</span>
          </h1>
          <p className="mt-3 text-graphite">
            To Studio Ana, 30 days early for 0.75% off. Settled in 0.6 seconds.{" "}
            <a href="#" className="text-ink underline decoration-rule underline-offset-4">
              Proof
            </a>
          </p>

          <ol className="mt-8 border-t border-ink">
            {checks.map((c) => (
              <li key={c.rule} className="grid grid-cols-[1.5rem_1fr] gap-3 border-b border-rule py-3">
                <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 text-seal" aria-hidden>
                  <path d="M2.5 8.5 L6.5 12 L13.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                </svg>
                <div>
                  <p className="font-medium">{c.rule}</p>
                  <p className="text-sm text-graphite">{c.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-graphite">
            Every rule above is checked again by Acme’s Vault before money moves. The Steward can’t skip one.
          </p>
        </section>
      </main>
    </div>
  );
}
