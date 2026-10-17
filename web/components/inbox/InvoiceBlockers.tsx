import Link from "next/link";
import type { ReactNode } from "react";

import type { Blocker } from "@/lib/blockers";
import { SectionTitle } from "@/components/ui/Type";
import { RecheckNow } from "@/components/inbox/RecheckNow";

const DOT: Record<Blocker["kind"], string> = { action: "bg-red", wait: "bg-warn", info: "bg-seal" };

/**
 * "What's stopping this payment": each reason in words, with where to deal with it, and the pay controls underneath
 * (plan 05zj C, SYM-06). With nothing in the way it says so, because that is the answer an owner is looking for.
 */
export function InvoiceBlockers({ blockers, children, checkedAt }: { blockers: Blocker[]; children?: ReactNode; checkedAt?: string }) {
  const inTheWay = blockers.filter((b) => b.kind !== "info" || b.rule === "ChainUnreadable");
  const later = blockers.filter((b) => !inTheWay.includes(b));
  return (
    <section aria-labelledby="stopping-title" className="mt-7 rounded-doc border border-rule bg-paper-raised px-5 py-4">
      <SectionTitle id="stopping-title">{inTheWay.length === 0 ? "Nothing is stopping this payment" : "What's stopping this payment"}</SectionTitle>
      {inTheWay.length === 0 ? (
        <p className="mt-2 text-sm text-graphite">
          Every check the Vault makes passes right now.{later.length > 0 ? " The Steward needs a person to sign this off; you can pay it yourself with Pay now." : ""}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {inTheWay.map((b) => (
            <li key={b.rule} className="flex gap-3 text-sm">
              <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${DOT[b.kind]}`} />
              <div className="min-w-0">
                <p className="font-medium text-ink">{b.title}</p>
                <p className="mt-0.5 text-graphite">{b.detail}</p>
                {b.action ? (
                  <Link href={b.action.href} className="mt-1 inline-block text-ink underline decoration-rule underline-offset-4 hover:text-seal">
                    {b.action.label} →
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {later.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-rule-soft pt-3 text-sm text-graphite">
          {later.map((b) => (
            <li key={b.rule}>
              {b.title}
              {b.action ? <> · <Link href={b.action.href} className="underline decoration-rule underline-offset-4 hover:text-ink">{b.action.label}</Link></> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {checkedAt ? <RecheckNow checkedAt={checkedAt} /> : null}
      {children ? <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule-soft pt-4">{children}</div> : null}
    </section>
  );
}
