import Link from "next/link";
import type { AheadSummary, NeedsYouSummary, TodaySummary } from "@/lib/server/home";

interface Props {
  needsYou: NeedsYouSummary;
  today: TodaySummary;
  ahead?: AheadSummary;
}

export function HomeQueues({ needsYou, today, ahead }: Props) {
  const totalNeedsCount =
    needsYou.awaitingApproval.count +
    needsYou.stewardHeld.count +
    needsYou.humanHeld.count +
    needsYou.unsignedBillsCount +
    needsYou.pendingVerificationsCount +
    needsYou.problems.length;

  return (
    <div className="mt-12 grid gap-12 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Needs you column */}
      <section aria-labelledby="needs-you-title" className="space-y-6">
        <div className="flex items-baseline justify-between border-b border-rule pb-3">
          <h2 id="needs-you-title" className="font-display text-3xl text-ink">
            Needs you
          </h2>
          <span className="font-mono text-sm text-graphite">{totalNeedsCount} pending</span>
        </div>

        {/* Problems / Alerts */}
        {needsYou.problems.length > 0 ? (
          <div className="space-y-2">
            {needsYou.problems.map((prob, idx) => (
              <div
                key={idx}
                className="rounded-doc border border-red/40 bg-red/5 p-4 text-xs text-red flex items-start gap-2"
              >
                <span className="mt-0.5 font-bold">!</span>
                <span>{prob}</span>
              </div>
            ))}
          </div>
        ) : null}

        {totalNeedsCount === 0 ? (
          <p className="rounded-doc border border-rule-soft bg-paper-raised p-6 text-sm text-graphite text-center">
            Nothing needs your attention right now.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Awaiting Approvals Queue */}
            {needsYou.awaitingApproval.count > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono uppercase tracking-wider text-seal font-medium">
                    Awaiting your approval ({needsYou.awaitingApproval.count})
                  </span>
                  <Link
                    href="/business/approvals"
                    className="text-graphite underline decoration-rule underline-offset-4 hover:text-ink"
                  >
                    View all in Approvals →
                  </Link>
                </div>

                {needsYou.awaitingApproval.top.map((item) => (
                  <Link
                    key={item.fingerprint}
                    href="/business/approvals"
                    className="block rounded-doc border border-seal/30 bg-paper-raised p-4 transition-colors hover:border-seal/60"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">{item.vendorName}</span>
                      <span className="font-mono text-ink">
                        ${item.amountFormatted} {item.token}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-graphite">
                      Invoice #{item.invoiceNumber} · {item.ruleNeededHuman}
                    </p>
                  </Link>
                ))}
              </div>
            ) : null}

            {/* Steward Held Queue */}
            {needsYou.stewardHeld.count > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono uppercase tracking-wider text-red font-medium">
                    Held by Steward policy ({needsYou.stewardHeld.count})
                  </span>
                  <Link
                    href="/business/inbox"
                    className="text-graphite underline decoration-rule underline-offset-4 hover:text-ink"
                  >
                    View in Inbox →
                  </Link>
                </div>

                {needsYou.stewardHeld.items.map((item) => (
                  <Link
                    key={item.fingerprint}
                    href={`/business/inbox/${item.fingerprint}`}
                    className="block rounded-doc border border-rule bg-paper-raised p-4 transition-colors hover:border-ink"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink">{item.vendorName}</span>
                      <span className="font-mono text-xs text-graphite">#{item.invoiceNumber}</span>
                    </div>
                    <p className="mt-1 text-xs text-red">Held: {item.reason}</p>
                  </Link>
                ))}
              </div>
            ) : null}

            {/* Human Held Queue */}
            {needsYou.humanHeld.count > 0 ? (
              <div className="rounded-doc border border-rule bg-paper-raised p-4 text-xs flex justify-between items-center">
                <div>
                  <span className="font-mono uppercase tracking-wider text-graphite font-medium">
                    Human held invoices
                  </span>
                  <p className="text-graphite mt-0.5">
                    {needsYou.humanHeld.count} invoice{needsYou.humanHeld.count === 1 ? "" : "s"} placed on manual hold by owners
                  </p>
                </div>
                <Link
                  href="/business/inbox"
                  className="text-ink underline decoration-rule underline-offset-4 hover:text-seal"
                >
                  View in Inbox →
                </Link>
              </div>
            ) : null}

            {/* Unsigned bills queue */}
            {needsYou.unsignedBillsCount > 0 ? (
              <div className="rounded-doc border border-rule bg-paper-raised p-4 text-xs flex justify-between items-center">
                <div>
                  <span className="font-mono uppercase tracking-wider text-graphite font-medium">
                    Unsigned bills open
                  </span>
                  <p className="text-graphite mt-0.5">
                    {needsYou.unsignedBillsCount} document{needsYou.unsignedBillsCount === 1 ? "" : "s"} uploaded without vendor Seal
                  </p>
                </div>
                <Link
                  href="/business/inbox?filter=unsigned"
                  className="text-ink underline decoration-rule underline-offset-4 hover:text-seal"
                >
                  Review bills →
                </Link>
              </div>
            ) : null}

            {/* Pending verifications */}
            {needsYou.pendingVerificationsCount > 0 ? (
              <div className="rounded-doc border border-rule bg-paper-raised p-4 text-xs flex justify-between items-center">
                <div>
                  <span className="font-mono uppercase tracking-wider text-graphite font-medium">
                    Payee verifications pending
                  </span>
                  <p className="text-graphite mt-0.5">
                    {needsYou.pendingVerificationsCount} vendor{needsYou.pendingVerificationsCount === 1 ? "" : "s"} awaiting second verification
                  </p>
                </div>
                <Link
                  href="/business/vendors"
                  className="text-ink underline decoration-rule underline-offset-4 hover:text-seal"
                >
                  Manage vendors →
                </Link>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {/* Today column */}
      <section aria-labelledby="today-title" className="space-y-6">
        <div className="flex items-baseline justify-between border-b border-rule pb-3">
          <h2 id="today-title" className="font-display text-3xl text-ink">
            Today
          </h2>
          <span className="font-mono text-xs text-graphite">
            As of {today.asOfTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-doc border border-rule bg-paper-raised p-5">
            <dt className="text-xs uppercase tracking-wider text-graphite font-medium">
              Payments settled today
            </dt>
            <dd className="mt-2 font-mono text-2xl font-medium text-ink">
              ${today.paymentsAmountFormatted}
            </dd>
            <p className="mt-1 text-xs text-graphite">
              {today.paymentsCount} onchain settlement{today.paymentsCount === 1 ? "" : "s"}
            </p>
          </div>

          <div className="rounded-doc border border-rule bg-paper-raised p-5">
            <dt className="text-xs uppercase tracking-wider text-graphite font-medium">
              Invoices due today
            </dt>
            <dd className="mt-2 font-mono text-2xl font-medium text-ink">
              {today.scheduledCount}
            </dd>
            <p className="mt-1 text-xs text-graphite">
              Scheduled or due on Arc
            </p>
          </div>
        </div>

        <div className="rounded-doc border border-rule bg-paper-raised p-5 flex items-center justify-between text-xs">
          <div>
            <span className="font-mono uppercase tracking-wider text-graphite font-medium">
              Decisions evaluated today
            </span>
            <p className="text-ink text-sm font-medium mt-1">
              {today.decisionsCount} decision{today.decisionsCount === 1 ? "" : "s"} recorded
            </p>
          </div>
          <Link
            href="/business/steward"
            className="text-graphite underline decoration-rule underline-offset-4 hover:text-ink"
          >
            Steward ledger →
          </Link>
        </div>
      </section>

      {/* Ahead section across bottom */}
      {ahead && (
        <section aria-labelledby="ahead-title" className="space-y-4 xl:col-span-2 border-t border-rule pt-8">
          <div className="flex items-baseline justify-between border-b border-rule pb-3">
            <div>
              <h2 id="ahead-title" className="font-display text-3xl text-ink">
                Ahead
              </h2>
              <p className="mt-1 text-xs text-graphite">{ahead.runwayStatement}</p>
            </div>
            <Link
              href="/business/treasury"
              className="text-xs text-graphite underline decoration-rule underline-offset-4 hover:text-ink"
            >
              Full treasury & forecast →
            </Link>
          </div>

          {/* Shortfalls banner if any */}
          {ahead.shortfalls.length > 0 && (
            <div className="space-y-2">
              {ahead.shortfalls.map((sf, idx) => (
                <div key={idx} className="rounded-doc border border-red/40 bg-red-wash/20 p-4 text-xs text-red">
                  <span className="font-bold">{sf.tokenSymbol} shortfall: </span>
                  Upcoming bills total {sf.tokenSymbol} {sf.dueFormatted}, which is {sf.tokenSymbol} {sf.shortFormatted} short.
                </div>
              ))}
            </div>
          )}

          {/* Upcoming 5 invoices */}
          {ahead.upcomingInvoices.length === 0 ? (
            <p className="rounded-doc border border-rule-soft bg-paper-raised p-6 text-sm text-graphite text-center">
              No unpaid invoices coming due in the forecast.
            </p>
          ) : (
            <div className="divide-y divide-rule border-y border-rule text-xs">
              {ahead.upcomingInvoices.map((inv) => (
                <div key={inv.fingerprint} className="py-2.5 flex items-center justify-between">
                  <div>
                    <span className="font-medium text-ink">{inv.vendorName}</span>
                    <span className="text-graphite ml-2 font-mono">#{inv.invoiceNumber}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-graphite">
                      Due {new Date(inv.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <span className="font-mono font-medium text-ink">
                      {inv.token === "EURC" ? "€" : "$"}{inv.amountFormatted}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
