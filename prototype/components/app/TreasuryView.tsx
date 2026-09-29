"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ForecastChart, type ForecastEvent } from "@/components/ForecastChart";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";
import { Overlay } from "@/components/Overlay";

const budgets = [
  { name: "Design", cap: 8000, spent: 1985, period: "this month" },
  { name: "Marketing", cap: 30000, spent: 17600, period: "this quarter" },
  { name: "Engineering", cap: 30000, spent: 12000, period: "this quarter" },
  { name: "Operations", cap: 45000, spent: 24000, period: "this quarter" },
];
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const eur = (v: number) => `€${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const events: ForecastEvent[] = [
  { day: 2, delta: -3.1, label: "Cloudline and 2 more", kind: "bill" },
  { day: 9, delta: -4.1, label: "Halden Freight", kind: "bill" },
  { day: 13, delta: 8.0, label: "Redeemed from reserve", kind: "redeem" },
  { day: 15, delta: -14.0, label: "Forge Supply F-778", kind: "bill" },
  { day: 24, delta: -2.6, label: "Kestrel Labs", kind: "bill" },
  { day: 30, delta: -2.4, label: "Studio Ana 0142", kind: "bill" },
];
const dates = [0, 7, 14, 21, 28, 35].map((d, i) => ({ day: d, label: ["28 Sep", "5 Oct", "12 Oct", "19 Oct", "26 Oct", "2 Nov"][i]! }));

// App Kit Swap quote for the shortfall (rate from the live testnet swap: 0.5 USDC → 0.410818 EURC)
const RATE = 0.821636;
const NEED_EUR = 1300;
const PAY_USD = Math.ceil((NEED_EUR / RATE) * 100) / 100;

/** Treasury (B15): balances, budgets as caps, the forecast, EURC, the reserve, Early Pay, withdrawals */
export function TreasuryView() {
  const [eurc, setEurc] = useState(2100);
  const [operating, setOperating] = useState(38320);
  const [convert, setConvert] = useState<"closed" | "quote" | "done">("closed");
  const [eligible, setEligible] = useState(true);
  const [reserveNote, setReserveNote] = useState<ReactNode>(null);
  const [withdraw, setWithdraw] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);
  const short = Math.max(0, 3400 - eurc);

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Treasury
      </h1>

      <dl data-reveal className="mt-8 grid grid-cols-2 gap-x-10 gap-y-6 border-y border-rule py-6 md:grid-cols-4">
        {[
          ["Operating", usd(operating), "USDC"],
          ["Euro balance", eur(eurc), "EURC"],
          ["Reserve", usd(22000), "in USYC"],
          ["Runway", "41 days", "at the forecast’s pace"],
        ].map(([k, v, n]) => (
          <div key={k}>
            <dt className="text-sm text-graphite">{k}</dt>
            <dd className="mt-1 font-display text-3xl leading-none tabular-nums">{v}</dd>
            <dd className="mt-1 text-xs text-graphite">{n}</dd>
          </div>
        ))}
      </dl>

      {short > 0 ? (
        <section data-reveal aria-labelledby="eurc" className="mt-8 rounded-doc border border-red/50 p-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-red">Euro shortfall</p>
          <h2 id="eurc" className="mt-2 text-xl font-medium">
            Nordlicht Studio’s invoice for {eur(3400)} is due 20 Oct. The euro balance is {eur(short)} short.
          </h2>
          <p className="mt-1 text-sm text-graphite">Your Vault never converts on its own. Convert some dollars to EURC before the due date, and the Steward pays on time.</p>
          <button onClick={() => setConvert("quote")} className="mt-4 rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
            Convert dollars to euros
          </button>
        </section>
      ) : convert === "done" ? (
        <p data-reveal role="status" className="mt-8 rounded-doc border border-seal/40 bg-seal-wash/40 px-5 py-4 text-sm">
          Converted {usd(PAY_USD)} to {eur(NEED_EUR)} at {RATE.toFixed(4)} EURC per USDC. Nordlicht Studio’s invoice is covered.{" "}
          <TxLink hash={tx.convert}>Transaction {tx.convert}</TxLink>
        </p>
      ) : null}

      <div className="mt-12 grid gap-12 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section data-reveal aria-labelledby="ahead">
          <h2 id="ahead" className="font-display text-3xl">
            The next five weeks
          </h2>
          <p className="mt-1 text-sm text-graphite">Operating balance in thousands of dollars · the buffer holds 30 days of bills</p>
          <ForecastChart start={38.3} days={35} buffer={20} events={events} dates={dates} />
        </section>

        <section data-reveal aria-labelledby="budgets">
          <h2 id="budgets" className="font-display text-3xl">
            Budgets
          </h2>
          <p className="mt-1 text-sm text-graphite">Caps on spending from one balance, not separate pots</p>
          <ul className="mt-5 space-y-4">
            {budgets.map((b) => (
              <li key={b.name}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{b.name}</span>
                  <span className="tabular-nums text-graphite">
                    {usd(b.spent)} of {usd(b.cap)} {b.period}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full bg-rule-soft" role="img" aria-label={`${Math.round((b.spent / b.cap) * 100)}% used`}>
                  <div className="h-full bg-ink" style={{ width: `${(b.spent / b.cap) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-14 grid gap-12 xl:grid-cols-2">
        <section data-reveal aria-labelledby="reserve">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="reserve" className="font-display text-3xl">
              Reserve
            </h2>
            <button onClick={() => setEligible(!eligible)} className="text-xs text-graphite underline decoration-rule underline-offset-4">
              {eligible ? "Show what a business that isn’t eligible sees" : "Back to Acme’s reserve"}
            </button>
          </div>
          {eligible ? (
            <>
              <p className="mt-2 text-sm text-seal">✓ Circle allows this Vault to hold USYC (checked live)</p>
              <p className="mt-4 font-display text-6xl leading-none">3.2%</p>
              <p className="mt-1 text-sm text-graphite">a year, from the USYC price’s last 30 daily rounds. Not a promise; it moves.</p>
              <dl className="mt-5 border-t border-ink text-sm">
                {[
                  ["Held", `${usd(22000)} in USYC, 36% of dollars`],
                  ["Most allowed", "60% of dollars"],
                  ["Operating never below", `${usd(20000)}`],
                  ["Next move", "Redeem $8,000.00 on 11 Oct, two days before Forge Supply’s bill"],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule py-2.5">
                    <dt className="text-graphite">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm">
                <Link href="/b/decisions/d-1131" className="underline decoration-rule underline-offset-4">
                  Today 11:31: moved $22,000.00 into the reserve
                </Link>{" "}
                <TxLink hash={tx.sweep}>{tx.sweep}</TxLink>
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() =>
                    setReserveNote(
                      <>
                        Redeemed $8,000.00 to operating. <TxLink hash={tx.redeem}>Transaction {tx.redeem}</TxLink>
                      </>,
                    )
                  }
                  className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                >
                  Redeem now
                </button>
                <button
                  onClick={() =>
                    setReserveNote(
                      <>
                        Reserve turned off; new moves into USYC stop. <TxLink hash={tx.policyApply}>Transaction {tx.policyApply}</TxLink>
                      </>,
                    )
                  }
                  className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                >
                  Turn the reserve off
                </button>
              </div>
              {reserveNote ? (
                <p role="status" className="mt-3 text-sm">
                  {reserveNote}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-graphite">You can always redeem, even while payments are paused. Turning it off applies at once.</p>
            </>
          ) : (
            <div className="mt-4 rounded-doc border border-rule p-5">
              <p className="font-medium">Your reserve stays in dollars</p>
              <p className="mt-2 text-sm text-graphite">
                USYC is only for businesses that aren’t U.S. persons and have been onboarded by Circle, whose own Vault Circle has allowed to
                hold it. Until then the Steward keeps your buffer and plans around your bills; it just doesn’t earn yield on idle cash.
              </p>
            </div>
          )}
        </section>

        <section data-reveal aria-labelledby="earlypay">
          <h2 id="earlypay" className="font-display text-3xl">
            Early Pay program
          </h2>
          <p className="mt-2 text-sm text-graphite">The Steward takes a vendor’s discount only if it beats the reserve by your margin, and keeps early payments under your cap.</p>
          <dl className="mt-5 border-t border-ink text-sm">
            {[
              ["Must beat reserve by", "3 points (so 6.2% a year today)"],
              ["Most committed at once", "30% of operating"],
              ["Taken this quarter", "4 discounts, $142.50 saved"],
              ["Declined this quarter", "2 that didn’t clear the bar"],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[12rem_1fr] gap-3 border-b border-rule py-2.5">
                <dt className="text-graphite">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <Link href="/b/policy" className="mt-3 inline-block text-sm underline decoration-rule underline-offset-4">
            Change these in Policy
          </Link>

          <h3 className="mt-10 font-medium">Withdraw or pay manually</h3>
          <p className="mt-1 text-sm text-graphite">Only the owner can. A manual payment, like an unsigned invoice you’ve checked yourself, is a withdrawal with a recorded reason.</p>
          <button onClick={() => setWithdraw(true)} className="mt-3 rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink">
            Withdraw
          </button>
          {withdrawn ? (
            <p role="status" className="mt-3 text-sm">
              Withdrawn and recorded with your reason. <TxLink hash={tx.withdraw}>Transaction {tx.withdraw}</TxLink>
            </p>
          ) : null}
        </section>
      </div>

      {convert === "quote" ? (
        <Overlay aria-labelledby="conv">
          <div className="w-full max-w-md rounded-t-2xl border border-rule bg-paper-raised p-7 shadow-2xl md:rounded-2xl">
            <h2 id="conv" className="font-display text-3xl">
              Convert to euros
            </h2>
            <dl className="mt-5 space-y-2 text-sm">
              {[
                ["You pay", `${usd(PAY_USD)} USDC from operating`],
                ["You get", `${eur(NEED_EUR)} EURC`],
                ["Rate", `${RATE.toFixed(4)} EURC per USDC`],
                ["At least", `${eur(Math.floor(NEED_EUR * 0.99 * 100) / 100)} (1% price protection)`],
                ["Via", "Circle App Kit Swap, on Arc"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4 border-b border-rule-soft pb-2">
                  <dt className="w-20 shrink-0 text-graphite">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-graphite">The quote holds for 30 seconds. If the price moves past the minimum, nothing is converted.</p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setEurc(eurc + NEED_EUR);
                  setOperating(Math.round((operating - PAY_USD) * 100) / 100);
                  setConvert("done");
                }}
                className="flex-1 rounded-doc bg-ink py-3 font-medium text-paper"
                autoFocus
              >
                Sign and convert
              </button>
              <button onClick={() => setConvert("closed")} className="rounded-doc border border-rule px-5 py-3">
                Cancel
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}

      {withdraw ? (
        <Overlay aria-labelledby="wd">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setWithdraw(false);
              setWithdrawn(true);
            }}
            className="w-full max-w-md space-y-4 rounded-t-2xl border border-rule bg-paper-raised p-7 shadow-2xl md:rounded-2xl"
          >
            <h2 id="wd" className="font-display text-3xl">
              Withdraw
            </h2>
            <label className="block text-sm">
              To
              <input required placeholder="0x…" className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2 font-mono text-sm" />
            </label>
            <label className="block text-sm">
              Amount (USDC)
              <input required inputMode="decimal" className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2" />
            </label>
            <label className="block text-sm">
              Why (recorded with the payment)
              <input required placeholder="Paying Mira’s unsigned invoice 77, checked by phone" className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2" />
            </label>
            <p className="text-xs text-graphite">This bypasses matching, so only the owner can sign it. It’s recorded like every decision.</p>
            <div className="flex gap-3">
              <button className="flex-1 rounded-doc bg-ink py-2.5 font-medium text-paper">Sign and withdraw</button>
              <button type="button" onClick={() => setWithdraw(false)} className="rounded-doc border border-rule px-4 py-2.5">
                Cancel
              </button>
            </div>
          </form>
        </Overlay>
      ) : null}
    </main>
  );
}
