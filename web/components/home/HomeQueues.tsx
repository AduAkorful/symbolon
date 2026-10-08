import Link from "next/link";
import type { AheadSummary, NeedsYouSummary, TodaySummary } from "@/lib/server/home";
import { formatDateTime, formatDay, showMoney } from "@/lib/format";
import { EmptyState, InlineError } from "@/components/ui/States";
import { Money } from "@/components/ui/Money";
import { Eyebrow, SectionTitle } from "@/components/ui/Type";

interface Props {
  needsYou: NeedsYouSummary;
  today: TodaySummary;
  ahead?: AheadSummary;
}

const sentence = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const more = "underline decoration-rule underline-offset-4 hover:text-ink";

/** One kind of thing waiting for the owner: what it is, how many, and where to deal with it */
function QueueRow({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-doc border border-rule bg-paper-raised px-5 py-4">
      <div className="min-w-0">
        <Eyebrow as="p">{title}</Eyebrow>
        <p className="mt-1 text-sm text-ink">{detail}</p>
      </div>
      <Link href={href} className={`shrink-0 text-sm text-ink ${more}`}>{action} →</Link>
    </div>
  );
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
    <div className="mt-12 grid gap-x-12 gap-y-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Needs you column */}
      <section aria-labelledby="needs-you-title" className="min-w-0 space-y-5">
        <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
          <SectionTitle id="needs-you-title">Needs you</SectionTitle>
          <span className="text-sm text-graphite">{totalNeedsCount === 0 ? "All clear" : `${totalNeedsCount} waiting`}</span>
        </div>

        {needsYou.problems.length > 0 ? (
          <div className="space-y-2">
            {needsYou.problems.map((prob, idx) => (
              <InlineError key={idx}>{prob}</InlineError>
            ))}
          </div>
        ) : null}

        {totalNeedsCount === 0 ? (
          <EmptyState title="Nothing needs you right now">Approvals, held invoices and verifications show up here when they do.</EmptyState>
        ) : (
          <div className="space-y-4">
            {needsYou.awaitingApproval.count > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Eyebrow as="span" className="text-seal">Awaiting your approval ({needsYou.awaitingApproval.count})</Eyebrow>
                  <Link href="/business/approvals" className={`text-graphite ${more}`}>All approvals →</Link>
                </div>
                {needsYou.awaitingApproval.top.map((item) => (
                  <Link
                    key={item.fingerprint}
                    href="/business/approvals"
                    className="block rounded-doc border border-seal/30 bg-paper-raised px-5 py-4 transition-colors hover:border-seal/60"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="min-w-0 truncate font-medium text-ink">{item.vendorName}</span>
                      <Money className="shrink-0 font-medium text-ink">{showMoney(item.amountFormatted, item.token)}</Money>
                    </div>
                    <p className="mt-1 text-sm text-graphite">
                      Invoice {item.invoiceNumber} · {item.ruleNeededHuman}
                    </p>
                  </Link>
                ))}
              </div>
            ) : null}

            {needsYou.stewardHeld.count > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <Eyebrow as="span" className="text-red">On hold by the Steward ({needsYou.stewardHeld.count})</Eyebrow>
                  <Link href="/business/inbox" className={`text-graphite ${more}`}>Open the inbox →</Link>
                </div>
                {needsYou.stewardHeld.items.map((item) => (
                  <Link
                    key={item.fingerprint}
                    href={`/business/inbox/${item.fingerprint}`}
                    className="block rounded-doc border border-rule bg-paper-raised px-5 py-4 transition-colors hover:border-ink"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="min-w-0 truncate font-medium text-ink">{item.vendorName}</span>
                      <span className="shrink-0 text-sm text-graphite">Invoice {item.invoiceNumber}</span>
                    </div>
                    <p className="mt-1 text-sm text-red">{sentence(item.reason)}</p>
                  </Link>
                ))}
              </div>
            ) : null}

            {needsYou.humanHeld.count > 0 ? (
              <QueueRow
                title="Held by a person"
                detail={`${plural(needsYou.humanHeld.count, "invoice")} on manual hold`}
                href="/business/inbox"
                action="Open the inbox"
              />
            ) : null}

            {needsYou.unsignedBillsCount > 0 ? (
              <QueueRow
                title="Unsigned bills"
                detail={`${plural(needsYou.unsignedBillsCount, "document")} uploaded without a vendor Seal. They can't be paid.`}
                href="/business/inbox?filter=unsigned"
                action="Review the bills"
              />
            ) : null}

            {needsYou.pendingVerificationsCount > 0 ? (
              <QueueRow
                title="Vendor verifications"
                detail={`${plural(needsYou.pendingVerificationsCount, "vendor")} waiting for a second confirmation`}
                href="/business/vendors"
                action="Open vendors"
              />
            ) : null}
          </div>
        )}
      </section>

      {/* Today column */}
      <section aria-labelledby="today-title" className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-3">
          <SectionTitle id="today-title">Today</SectionTitle>
          <span className="text-sm text-graphite">As of {formatDateTime(today.asOfTime)}</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-doc border border-rule bg-paper-raised px-5 py-4">
            <Eyebrow as="p">Paid today</Eyebrow>
            <Money className="mt-2 block font-display text-3xl text-ink">{showMoney(today.paymentsAmountFormatted, "USDC")}</Money>
            <p className="mt-1 text-sm text-graphite">{plural(today.paymentsCount, "settlement")} on Arc</p>
          </div>

          <div className="rounded-doc border border-rule bg-paper-raised px-5 py-4">
            <Eyebrow as="p">Due today</Eyebrow>
            <p className="mt-2 font-display text-3xl text-ink">{today.scheduledCount}</p>
            <p className="mt-1 text-sm text-graphite">{today.scheduledCount === 1 ? "invoice" : "invoices"} scheduled or due</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-doc border border-rule bg-paper-raised px-5 py-4">
          <div>
            <Eyebrow as="p">Steward decisions today</Eyebrow>
            <p className="mt-1 text-sm font-medium text-ink">{plural(today.decisionsCount, "decision")} recorded</p>
          </div>
          <Link href="/business/steward" className={`text-sm text-graphite ${more}`}>Steward activity →</Link>
        </div>
      </section>

      {/* Ahead section across bottom */}
      {ahead ? (
        <section aria-labelledby="ahead-title" className="min-w-0 space-y-4 border-t border-rule pt-8 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule pb-3">
            <div className="min-w-0">
              <SectionTitle id="ahead-title">Ahead</SectionTitle>
              <p className="mt-1 text-sm text-graphite">{ahead.runwayStatement}</p>
            </div>
            <Link href="/business/treasury" className={`text-sm text-graphite ${more}`}>Treasury and forecast →</Link>
          </div>

          {ahead.shortfalls.length > 0 ? (
            <div className="space-y-2">
              {ahead.shortfalls.map((sf, idx) => (
                <InlineError key={idx}>
                  <strong>{sf.tokenSymbol} shortfall.</strong> Upcoming bills total {showMoney(sf.dueFormatted, sf.tokenSymbol)}, which is {showMoney(sf.shortFormatted, sf.tokenSymbol)} more than the Vault holds.
                </InlineError>
              ))}
            </div>
          ) : null}

          {ahead.upcomingInvoices.length === 0 ? (
            <EmptyState title="No unpaid invoices coming due">Invoices that fall due in the forecast period are listed here.</EmptyState>
          ) : (
            <ul className="divide-y divide-rule-soft border-y border-rule text-sm">
              {ahead.upcomingInvoices.map((inv) => (
                <li key={inv.fingerprint} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{inv.vendorName}</span>
                    <span className="ml-2 text-graphite">Invoice {inv.invoiceNumber}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-5">
                    <span className="whitespace-nowrap text-graphite">Due {formatDay(inv.dueDate)}</span>
                    <Money className="font-medium text-ink">{showMoney(inv.amountFormatted, inv.token)}</Money>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
