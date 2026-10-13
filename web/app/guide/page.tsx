import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { arcChain } from "@symbolon/chain";

import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { CONTAINER } from "@/components/shell/container";
import { getConfig } from "@/lib/server/config";
import { describePolicy, TEMPLATES } from "@/lib/server/policy-text";

// the network settings come from the running deployment's config, which isn't known when the build prerenders
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get started",
  description: "How to send invoices or pay them with Symbolon, in plain words, and what you need to try it on Arc testnet.",
};

const FAUCET = "https://faucet.circle.com";
const ARC_DOCS = "https://docs.arc.io/arc/references/connect-to-arc";

const link = "underline decoration-rule underline-offset-4 hover:text-ink";

/**
 * The onboarding page (plans 05zj G and 05zm). It is written for someone who has never used a crypto wallet: each step names a
 * screen or button the app has, the everyday word comes before the technical one, and the policy summaries are drawn from the same
 * code the Vault is created from, so a number here can't differ from the product. Nothing on it claims more than the app does.
 */
export default function GuidePage() {
  const config = getConfig();
  const chain = arcChain(config.chainId);
  const rpc = chain.rpcUrls.default.http[0];
  const explorer = chain.blockExplorers?.default.url;
  const { tokens } = config.deployment;

  const settings: [string, string][] = [
    ["Network name", chain.name],
    ["Chain ID", String(chain.id)],
    ["RPC URL", rpc ?? "—"],
    ["Currency symbol", chain.nativeCurrency.symbol],
    ["Block explorer", explorer ?? "—"],
  ];

  return (
    <div className="flex min-h-screen flex-col justify-between">
      <PublicHeader />
      <main id="main-content" className={`${CONTAINER} w-full flex-1 pb-14 pt-14`}>
        <h1 className="font-display text-4xl leading-tight md:text-5xl">Get started</h1>
        <p className="mt-3 max-w-[62ch] text-lg text-graphite">
          Symbolon is a way for a business to pay its invoices safely, and for a vendor to get paid quickly. You don’t need to know
          anything about crypto to use it: this page walks you through it, one step at a time.
        </p>
        <p role="note" className="mt-4 max-w-[62ch] rounded-doc border border-rule px-4 py-3 text-sm text-graphite">
          Right now Symbolon runs on <strong className="font-medium text-ink">{chain.name}</strong>, a test network. The money in it is
          test money and has no value. That makes it a safe place to try everything.
        </p>

        <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <a href="#how" className={link}>How it works</a>
          <a href="#vendor" className={link}>I send invoices</a>
          <a href="#business" className={link}>I pay invoices</a>
          <a href="#words" className={link}>Words used here</a>
          <a href="#stuck" className={link}>If something looks stuck</a>
          <a href="#setup" className={link}>Test network setup</a>
        </nav>

        <Section id="how" title="How it works, in one minute">
          <ol className="mt-4 space-y-3 text-graphite">
            <Item n={1}>A <strong className="font-medium text-ink">vendor</strong> makes an invoice and signs it with their own mark, a <em>Seal</em>. Nobody can change it afterwards without it showing.</Item>
            <Item n={2}>The <strong className="font-medium text-ink">business</strong> keeps its money in a <em>Vault</em>, an account only the business owner controls. The Vault pays an invoice only when everything lines up with the rules the owner chose.</Item>
            <Item n={3}>A software assistant, the <em>Steward</em>, helps with timing and routine work. It works inside those rules and can never change them.</Item>
            <Item n={4}>Every payment is recorded publicly, so both sides can check what was paid, when, and why.</Item>
          </ol>
        </Section>

        <Section id="vendor" title="If you send invoices (vendor)">
          <p className="mt-3 max-w-[62ch] text-graphite">
            You can start without any money in a wallet: signing an invoice is free. Here is the whole path.
          </p>
          <ol className="mt-5 space-y-5">
            <Step n={1} title="Sign in">
              Go to <Link href="/signin" className={link}>Sign in</Link> and use your email. A wallet is created for you behind the scenes, which is just
              the account that proves it’s you. If you already have a crypto wallet, you can use that instead.
            </Step>
            <Step n={2} title="Set up your Seal">
              Open <Link href="/vendor/start" className={link}>Start as a vendor</Link>. Pick a short handle (it becomes part of your invoice links) and
              the name that appears on your invoices. Add the address where you want to be paid; you can add it later in <strong className="font-medium text-ink">Settings</strong>.
            </Step>
            <Step n={3} title="Make an invoice">
              Choose <strong className="font-medium text-ink">New invoice</strong>. Say who it’s for, what it’s for and how much. You review exactly what will be signed
              before you sign it, and signing costs nothing. If you have a PDF bill, <strong className="font-medium text-ink">Upload</strong> can turn it into a draft for you to check, where
              that option is switched on.
            </Step>
            <Step n={4} title="Share it">
              Every signed invoice gets a link. Send it to your customer. Anyone who opens it, or pastes it into <Link href="/verify" className={link}>Verify</Link>, can
              see that it really came from you and hasn’t been altered. Checking happens in their browser; nothing is uploaded.
            </Step>
            <Step n={5} title="Let the business confirm you">
              A business confirms who you are before it pays you the first time, in one of two ways.
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><strong className="font-medium text-ink">An invitation.</strong> The business sends you a one-time link, by a channel it already trusts. Open it, sign in, create your Seal if you don’t have one yet, and accept. If you already have a Seal, you just accept.</li>
                <li><strong className="font-medium text-ink">A callback code.</strong> After you’ve sent them an invoice, the business may phone you on a number it already trusted. Sign in, open <strong className="font-medium text-ink">Checks</strong>, and read the six-digit code you see there to them on the call. They type it in on their side.</li>
              </ul>
              <span className="mt-2 block">
                Then the business adds you to the list of vendors it pays. New vendors wait a short while before the first payment; that is a
                safety rule the business chose, and the business can see how long is left.
              </span>
            </Step>
            <Step n={6} title="Get paid">
              When the invoice matches the business’s rules, the Vault pays it. Your invoice shows <strong className="font-medium text-ink">Paid</strong>, with a receipt you can share.
              Optional: <strong className="font-medium text-ink">Early Pay</strong> lets you offer a small discount for being paid sooner. You can add it when you
              make the invoice, or open an unpaid invoice and choose to get paid early: you pick the discount, sign it, and the business’s team or Steward reviews it. It’s always your choice, and the business can accept, counter or decline.
            </Step>
            <Step n={7} title="If your payout address changes">
              In Settings you sign a request for the new address. Each business confirms it and a waiting period passes before it takes effect, so
              nobody can quietly redirect your money.
            </Step>
          </ol>
          <p className="mt-6 text-sm text-graphite">
            What costs money: only actions that change something on the network, such as cancelling an invoice. They need a small amount of
            USDC in your wallet for the network fee (see the setup section below).
          </p>
        </Section>

        <Section id="business" title="If you pay invoices (business)">
          <p className="mt-3 max-w-[62ch] text-graphite">
            The person who sets up the business is its <strong className="font-medium text-ink">owner</strong>. You’ll need a little testnet USDC to start; the section below says where to get it.
          </p>
          <ol className="mt-5 space-y-5">
            <Step n={1} title="Sign in and set up">
              <Link href="/signin" className={link}>Sign in</Link> with your email or your wallet, then choose <Link href="/setup" className={link}>Set up a business</Link>. Give the business a name.
            </Step>
            <Step n={2} title="Choose your rules">
              Pick one of three starting sets of rules. You can change them later; making them <em>looser</em> always waits a delay, so a mistake or a
              stolen login can’t quietly open things up.
              <ul className="mt-3 grid gap-3 md:grid-cols-3">
                {TEMPLATES.map((key) => {
                  const t = describePolicy(key);
                  return (
                    <li key={key} className="rounded-doc border border-rule px-4 py-3">
                      <p className="font-medium text-ink">{t.name}</p>
                      <p className="mt-1 text-sm text-graphite">{t.blurb}</p>
                      <ul className="mt-2 space-y-1 text-sm text-graphite">
                        {t.lines.slice(0, 5).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </Step>
            <Step n={3} title="Create your Vault">
              The Vault is the account that holds the money and applies those rules. Your wallet asks you to approve creating it; that one step
              costs a small network fee in USDC. The Steward starts <strong className="font-medium text-ink">paused</strong>, so nothing can be paid until you decide.
            </Step>
            <Step n={4} title="Add funds">
              Use <strong className="font-medium text-ink">Add funds</strong> (in setup, or later under Treasury) to move USDC from your wallet into the Vault. Use that button rather than
              your wallet’s own “Send”: it is the path we’ve checked, and on an older Vault a plain send fails. EURC works too once you turn it on in Settings.
            </Step>
            <Step n={5} title="Resume payments">
              When you’re ready for the Vault to pay, resume it from the Steward page or the header. You can pause everything again, instantly, at any time.
            </Step>
            <Step n={6} title="Receive an invoice">
              Invoices from vendors arrive in your <strong className="font-medium text-ink">Inbox</strong>. Each one is checked against its signature and your records. Open it to see what it is, who
              sent it, and, if something stops it from being paid, a plain list of what.
            </Step>
            <Step n={7} title="Confirm the vendor">
              Under <strong className="font-medium text-ink">Vendors</strong>, confirm the company is who you mean to pay, in one of two ways.
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><strong className="font-medium text-ink">Invite them.</strong> Choose <em>Invite a vendor</em>, copy the one-time link and send it through a channel you already trust. It is shown once and expires in 14 days; if you lose it, withdraw the invitation and make a new one.</li>
                <li><strong className="font-medium text-ink">Call them back.</strong> For a vendor that has already sent you an invoice, choose <em>Verify by trusted callback</em>. Phone them on a number you trusted from before the invoice, ask them to open <em>Checks</em> in their account and read you the six-digit code, then enter it.</li>
              </ul>
            </Step>
            <Step n={8} title="Add them as a payee">
              Once a vendor is verified, the owner chooses <em>Set up as a payee</em>, picks the payout address the vendor signed, and signs one transaction. The dialog
              shows when the first payment can be made: their first payment waits out your <em>new payee wait</em>.
            </Step>
            <Step n={9} title="Screen them (if your rules ask for it)">
              The Standard and Strict rules want a recent compliance screening of the payee’s payout address. Open <strong className="font-medium text-ink">Compliance</strong>, choose <em>Screen</em>, then
              <em> Save in the Vault</em> to record the result. This works once the vendor is a payee.
            </Step>
            <Step n={10} title="Optional: orders and delivery">
              For vendors you want to limit, open a <strong className="font-medium text-ink">purchase order</strong>, and confirm <strong className="font-medium text-ink">delivery</strong> when the work
              arrives. The Vault will then pay only up to what was ordered.
            </Step>
            <Step n={11} title="Let the Steward help, at your pace">
              On the <strong className="font-medium text-ink">Steward</strong> page, <em>Shadow</em> watches and recommends but pays nothing, <em>Assisted</em> proposes payments for you to approve, and
              <em> Autonomous</em> pays within your limits. Most people start with Shadow and move up when the recommendations look right.
            </Step>
            <Step n={12} title="Approve and pay">
              Payments that need a person show up in <strong className="font-medium text-ink">Approvals</strong>. You can also pay an invoice yourself from its page. Every
              payment, and every decision the Steward made, is in <strong className="font-medium text-ink">Activity</strong>, and you can export it from <strong className="font-medium text-ink">Accounting</strong>.
            </Step>
            <Step n={13} title="Bring your team">
              Under <strong className="font-medium text-ink">Team</strong>, invite colleagues with a role:
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><strong className="font-medium text-ink">Approver:</strong> can approve payments.</li>
                <li><strong className="font-medium text-ink">Requester:</strong> can ask for payments.</li>
                <li><strong className="font-medium text-ink">Viewer:</strong> read only.</li>
              </ul>
              <span className="mt-2 block">Giving someone more power waits for your Vault’s delay, like any loosening of the rules.</span>
            </Step>
          </ol>

          <div className="mt-8 rounded-doc border border-rule px-5 py-4">
            <h3 className="font-display text-xl">What the Steward can never do</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-graphite">
              <li>Add a vendor, change where a vendor is paid, or change your rules. Only a person can.</li>
              <li>Pay anything that isn’t a signed invoice, or pay the same invoice twice.</li>
              <li>Pay a discount the vendor didn’t sign.</li>
              <li>Move money outside your limits: the Vault itself enforces them, not the Steward.</li>
            </ul>
          </div>
        </Section>

        <Section id="words" title="Words used here">
          <dl className="mt-4 divide-y divide-rule-soft border-y border-rule text-sm">
            {(
              [
                ["Seal", "A vendor’s signature on an invoice. It proves who sent it and that it hasn’t changed."],
                ["Vault", "A business’s own account for paying bills. It follows the owner’s rules and only the owner can change them."],
                ["Steward", "The software assistant that handles timing and routine work inside the Vault’s rules."],
                ["Payee", "A vendor the business has confirmed and added to the list it pays."],
                ["Policy", "The owner’s rules: how much can be paid without a person, who must approve, how long new vendors wait."],
                ["Wallet", "The account that proves who you are and signs for you. Sign in with email and one is made for you."],
                ["Network fee", "A small charge for actions that change something on the network. On Arc it’s paid in USDC."],
                ["USDC and EURC", "Digital dollars and euros. On the test network they are free test money."],
                ["Arc", "The network Symbolon runs on. Everything that happens on it is public, so it can be checked."],
              ] as const
            ).map(([term, meaning]) => (
              <div key={term} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt className="font-medium text-ink">{term}</dt>
                <dd className="text-graphite">{meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="stuck" title="If something looks stuck">
          <dl className="mt-4 divide-y divide-rule-soft border-y border-rule text-sm">
            {(
              [
                ["A new vendor can’t be paid yet.", "New payees wait before their first payment. The invoice page shows how long is left."],
                ["An invoice won’t pay.", "Open it: the page lists exactly what is in the way (a missing order, delivery, a screening, a limit) and where to fix it."],
                ["“Can’t confirm” is showing.", "The network didn’t answer just then. Nothing is shown rather than a guess; reload in a moment."],
                ["My wallet says it has no fee money.", "Actions that change something need a little USDC in the wallet for the network fee. The faucet below gives test USDC."],
                ["I sent USDC but the Vault doesn’t show it.", "Use Add funds, not your wallet’s Send. It can take a few moments to appear; the screen says when it has."],
                ["Nothing happens on the Steward page.", "Check that payments aren’t paused and that the Steward’s own wallet has fee money; the page says which."],
              ] as const
            ).map(([q, a]) => (
              <div key={q} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:gap-4">
                <dt className="font-medium text-ink">{q}</dt>
                <dd className="text-graphite">{a}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="setup" title="Test network setup">
          <h3 className="mt-4 font-display text-xl">Get testnet USDC</h3>
          <p className="mt-2 max-w-[62ch] text-graphite">
            Arc’s documentation points to Circle’s faucet for testnet tokens:{" "}
            <a href={FAUCET} target="_blank" rel="noreferrer" className={link}>faucet.circle.com ↗</a>. Choose {chain.name}, paste the address of the wallet you sign in
            with, and request USDC. If it offers EURC for this network and you want to try EURC invoices, ask for that too.
          </p>
          <p className="mt-3 max-w-[62ch] text-graphite">On Arc, USDC is also the network’s own coin, which is why a wallet shows it as the fee currency.</p>

          <h3 className="mt-8 font-display text-xl">Add the network to your wallet</h3>
          <p className="mt-2 max-w-[62ch] text-graphite">
            Symbolon adds {chain.name} for you when your wallet is asked to sign. If you would rather add it first, these are the settings.
            Arc’s own page lists the same values:{" "}
            <a href={ARC_DOCS} target="_blank" rel="noreferrer" className={link}>docs.arc.io ↗</a>.
          </p>
          <dl className="mt-4 divide-y divide-rule-soft border-y border-rule text-sm">
            {settings.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-graphite">{k}</dt>
                <dd className="break-all font-mono text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-8 font-display text-xl">The tokens</h3>
          <p className="mt-2 max-w-[62ch] text-graphite">
            A wallet that doesn’t know a token shows it as unknown. Both have 6 decimals. The setup and Add funds screens can add them to your wallet for you.
          </p>
          <dl className="mt-4 divide-y divide-rule-soft border-y border-rule text-sm">
            {([["USDC", tokens.usdc], ["EURC", tokens.eurc]] as const).map(([k, v]) => (
              <div key={k} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-graphite">{k}</dt>
                <dd className="break-all font-mono text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <p className="mt-12 max-w-3xl text-sm text-graphite">
          Want to read what you are trusting? <Link href="/status" className={link}>The deployed contracts and their live checks</Link>.
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-14 max-w-3xl scroll-mt-24">
      <h2 id={`${id}-title`} className="font-display text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function Item({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-rule text-xs text-graphite">{n}</span>
      <span>{children}</span>
    </li>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-seal text-sm text-seal">{n}</span>
      <div className="min-w-0">
        <h3 className="font-medium text-ink">{title}</h3>
        <div className="mt-1 text-graphite">{children}</div>
      </div>
    </li>
  );
}
