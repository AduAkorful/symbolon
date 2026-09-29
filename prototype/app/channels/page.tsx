import Link from "next/link";
import type { ReactNode } from "react";
import { Act } from "@/components/Act";
import { DemoTag, Wordmark } from "@/components/Marks";

/**
 * Every message in every channel has the same anatomy, so a row reads as a set: a channel label, who it's from,
 * the message, and a footer band with the actions. The footers line up across a row whatever the message length.
 */
const card = "flex h-full flex-col overflow-hidden rounded-doc border border-rule bg-paper-raised";
const label = "font-mono text-[10px] uppercase tracking-[0.14em] text-graphite";
const footer = "flex flex-wrap items-center gap-2 border-t border-rule bg-paper/50 px-5 py-3.5";

function Email({ from, to, subject, children, actions }: { from: string; to: string; subject: string; children: ReactNode; actions: ReactNode }) {
  return (
    <article className={card}>
      <header className="border-b border-rule px-5 py-4">
        <p className={label}>Email</p>
        <p className="mt-2 text-xs text-graphite">
          <span className="text-ink">{from}</span> to {to}
        </p>
        <h3 className="mt-1.5 min-h-[2.9rem] text-[15px] font-medium leading-snug">{subject}</h3>
      </header>
      <div className="flex-1 space-y-3 px-5 py-4 text-sm leading-relaxed">{children}</div>
      <footer className={footer}>{actions}</footer>
    </article>
  );
}

function Chat({ app, where, children, actions }: { app: string; where: string; children: ReactNode; actions: ReactNode }) {
  return (
    <article className={card}>
      <header className="border-b border-rule px-5 py-4">
        <p className={label}>{app}</p>
        <p className="mt-2 text-xs text-graphite">{where}</p>
        <div className="mt-1.5 flex min-h-[2.9rem] items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm bg-ink font-display text-paper" aria-hidden>
            S
          </span>
          <p className="text-[15px] font-medium leading-snug">
            Symbolon <span className="font-normal text-graphite">· Acme’s Steward</span>
          </p>
        </div>
      </header>
      <div className="flex-1 space-y-3 px-5 py-4 text-sm leading-relaxed">{children}</div>
      <footer className={footer}>{actions}</footer>
    </article>
  );
}

const look = (primary: boolean) => `rounded-doc px-3.5 py-1.5 text-sm ${primary ? "bg-ink font-medium text-paper" : "border border-rule hover:border-ink"}`;

/** A button in a message: it opens the screen it points at, or does its small thing and says so */
function Btn({ children, primary = false, href, done }: { children: ReactNode; primary?: boolean; href?: string; done?: string }) {
  if (href)
    return (
      <Link href={href} className={look(primary)}>
        {children}
      </Link>
    );
  return (
    <Act className={look(primary)} done={done ?? "Done."}>
      {children}
    </Act>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="mt-14 first-of-type:mt-12">
      <h2 className="font-display text-3xl">{title}</h2>
      <p className="mt-1 text-sm text-graphite">{note}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Channels (C1–C3): approvals and news where people already are */
export default function Channels() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 pt-7 md:px-10">
        <Link href="/b">
          <Wordmark />
        </Link>
        <DemoTag />
      </header>
      <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-12 md:px-10">
        <h1 className="font-display text-5xl">Outside the app</h1>
        <p className="mt-2 max-w-[64ch] text-graphite">Approvals and news reach people where they already are. Every approval is still signed on the person’s own device.</p>

        <Section title="Approvals" note="The Steward asks in the place each person already uses. The signature always happens on their own device.">
          <div className="grid items-stretch gap-6 lg:grid-cols-3">
            <Email
              from="Acme’s Steward"
              to="ama@acme.example"
              subject="Approve: Northwind wants $8,892.00 today instead of $9,000.00 on 23 Oct"
              actions={
                <>
                  <Btn primary href="/b/approvals">
                    Approve and sign
                  </Btn>
                  <Btn href="/b/approvals">Open in Symbolon</Btn>
                </>
              }
            >
              <p>Northwind Agency offered 1.2% off invoice 2291 to be paid today. I recommend accepting: about 17.5% a year, against 3.2% in reserve.</p>
              <p className="text-graphite">Needs $5,000.00 from reserve. Runway after: 52 days. You’re asked because it’s above the $2,500.00 auto-pay limit.</p>
            </Email>

            <Chat
              app="Slack"
              where="#payables"
              actions={
                <>
                  <Btn primary done="Opened a signing request on Ama’s phone. Approvals are signed on the person’s own device.">
                    Approve
                  </Btn>
                  <Btn done="Rejected. Northwind is told the offer wasn’t accepted.">Reject</Btn>
                  <Btn href="/b/decisions/d-1402">Why?</Btn>
                </>
              }
            >
              <p>
                <strong>Needs approval:</strong> Northwind Agency, 8,892.00 today (1.2% off 9,000.00, due 23 Oct).
              </p>
              <p className="text-graphite">Steward recommends accepting · 17.5% a year vs 3.2% · runway after 52 days</p>
            </Chat>

            <Chat
              app="Telegram"
              where="Direct message to the owner"
              actions={
                <>
                  <Btn primary done="Opened a signing request on the owner’s phone.">
                    Sign on phone
                  </Btn>
                  <Btn done="Okay. I’ll remind you tomorrow at 09:00.">Later</Btn>
                </>
              }
            >
              <p>Forge Supply’s F-778 ($14,000.00) was delivered and matched. It needs the owner’s signature; I recommend paying on 13 Oct.</p>
            </Chat>
          </div>
        </Section>

        <Section title="The weekly digest" note="One email a week to the owner, from the Steward: what happened, and what needs a person.">
          <article className={card}>
            <header className="border-b border-rule px-5 py-4">
              <p className={label}>Email</p>
              <p className="mt-2 text-xs text-graphite">
                <span className="text-ink">Acme’s Steward</span> to owner@acme.example
              </p>
              <h3 className="mt-1.5 text-[15px] font-medium leading-snug">Your week: 12 paid, $142.50 saved, 1 fraud attempt stopped</h3>
            </header>
            <div className="grid flex-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <dl className="px-5 py-4 text-sm">
                {[
                  ["Paid", "12 invoices, $31,405.00"],
                  ["Saved with Early Pay", "$142.50 across 4 discounts"],
                  ["Reserve", "$22,000.00, from today"],
                  ["Asked you", "5 times; you agreed 4 times"],
                  ["Runway", "41 days"],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[10.5rem_1fr] gap-3 border-b border-rule-soft py-2 last:border-0">
                    <dt className="text-graphite">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="border-t border-rule px-5 py-4 text-sm leading-relaxed lg:border-l lg:border-t-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-red">Unusual</p>
                <p className="mt-2">An unsealed email pretending to be Studio Ana asked for a new address. Refused.</p>
                <p className="mt-2 text-graphite">Northwind’s payout change is in its cooldown and needs you.</p>
              </div>
            </div>
            <footer className={footer}>
              <Btn primary href="/b">
                Open Symbolon
              </Btn>
              <Btn href="/b/vendors">Review Northwind’s change</Btn>
            </footer>
          </article>
        </Section>

        <Section title="To vendors" note="What vendors, and the clients they invoice, hear from Symbolon.">
          <div className="grid items-stretch gap-6 lg:grid-cols-3">
            <Email
              from="Symbolon"
              to="ana@studio-ana.com"
              subject="You’ve been paid $1,985.00 by Acme Operations"
              actions={
                <Btn primary href="/p/receipt">
                  See the receipt
                </Btn>
              }
            >
              <p>Invoice 0143, 30 days early, with the 0.75% discount you signed. It’s in your wallet on Arc.</p>
            </Email>
            <Email
              from="Symbolon"
              to="ana@studio-ana.com"
              subject="Acme countered your offer on 0142"
              actions={
                <>
                  <Btn primary href="/v/invoices/0142/early">
                    Accept 0.75%
                  </Btn>
                  <Btn done="Declined. You’re paid in full on 28 Oct.">Decline</Btn>
                </>
              }
            >
              <p>You offered 1.2% to be paid today. Acme can pay $2,382.00 today at 0.75%, or the full $2,400.00 on 28 Oct.</p>
            </Email>
            <Email
              from="Symbolon"
              to="finance@acme.example"
              subject="Studio Ana sent you an invoice for 2,400.00 USDC"
              actions={
                <Btn primary href="/p/invoice">
                  Open the invoice
                </Btn>
              }
            >
              <p>Sealed by Studio Ana (@studio-ana). Due 28 Oct; 1.5% off if paid by 1 Oct.</p>
              <p className="text-graphite">Check it’s genuine before paying: the link shows who sealed it and whether it was changed.</p>
            </Email>
          </div>
        </Section>
      </main>
    </div>
  );
}
