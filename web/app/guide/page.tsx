import type { Metadata } from "next";
import Link from "next/link";
import { arcChain } from "@symbolon/chain";

import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { CONTAINER } from "@/components/shell/container";
import { getConfig } from "@/lib/server/config";

// the network settings come from the running deployment's config, which isn't known when the build prerenders
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Get started",
  description: "What you need to try Symbolon on Arc testnet: a wallet, the network settings, and a little testnet USDC.",
};

const FAUCET = "https://faucet.circle.com";
const ARC_DOCS = "https://docs.arc.io/arc/references/connect-to-arc";

const link = "underline decoration-rule underline-offset-4 hover:text-ink";

/**
 * A short page for someone trying Symbolon on testnet (plan 05zj G, SYM-37). Symbolon has no documentation site of its own, so this
 * says only what the app can stand behind: the network settings come from the deployment registry, and the two outside links are
 * the ones Arc's own docs name. Nothing here claims more than that.
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
        <h1 className="font-display text-4xl leading-tight md:text-5xl">Get started on Arc testnet</h1>
        <p className="mt-3 max-w-[60ch] text-graphite">
          Symbolon runs on {chain.name}, a test network: the money is not real. You need a way to sign (a wallet, or an email that makes one for you) and,
          for a business, a little testnet USDC.
        </p>

        <section className="mt-12 max-w-3xl" aria-labelledby="who">
          <h2 id="who" className="font-display text-2xl">What you need, by what you want to do</h2>
          <dl className="mt-4 divide-y divide-rule-soft border-y border-rule text-sm">
            <div className="grid gap-1 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-medium text-ink">Send invoices</dt>
              <dd className="text-graphite">
                A wallet or an email. Sealing an invoice is a signature, which costs nothing. Cancelling one is a transaction, which costs a small fee in USDC.{" "}
                <Link href="/vendor/start" className={link}>Start as a vendor</Link>
              </dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-medium text-ink">Pay invoices</dt>
              <dd className="text-graphite">
                A wallet or an email, and testnet USDC in that wallet: creating a Vault, funding it and every owner action pay Arc&apos;s network fee in USDC.{" "}
                <Link href="/setup" className={link}>Set up a business</Link>
              </dd>
            </div>
            <div className="grid gap-1 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
              <dt className="font-medium text-ink">Check an invoice</dt>
              <dd className="text-graphite">
                Nothing. The check runs in your browser and nothing is uploaded.{" "}
                <Link href="/verify" className={link}>Verify an invoice</Link>
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-12 max-w-3xl" aria-labelledby="funds">
          <h2 id="funds" className="font-display text-2xl">Get testnet USDC</h2>
          <p className="mt-3 text-graphite">
            Arc&apos;s documentation points to Circle&apos;s faucet for testnet tokens:{" "}
            <a href={FAUCET} target="_blank" rel="noreferrer" className={link}>faucet.circle.com ↗</a>. Choose {chain.name}, paste the address of the wallet you sign in
            with, and request USDC. If it offers EURC for this network and you want to try EURC invoices, ask for that too.
          </p>
          <p className="mt-3 text-graphite">On Arc, USDC is also the network&apos;s own coin, which is why a wallet shows it as the fee currency.</p>
        </section>

        <section className="mt-12 max-w-3xl" aria-labelledby="network">
          <h2 id="network" className="font-display text-2xl">Add the network to your wallet</h2>
          <p className="mt-3 text-graphite">
            Symbolon adds {chain.name} for you when your wallet is asked to sign. If you would rather add it first, these are the settings.
            Arc&apos;s own page lists the same values:{" "}
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
        </section>

        <section className="mt-12 max-w-3xl" aria-labelledby="tokens">
          <h2 id="tokens" className="font-display text-2xl">The tokens</h2>
          <p className="mt-3 text-graphite">
            A wallet that doesn&apos;t know a token shows it as unknown. Both have 6 decimals. The setup and Add funds screens can add them to your wallet for you.
          </p>
          <dl className="mt-4 divide-y divide-rule-soft border-y border-rule text-sm">
            {([["USDC", tokens.usdc], ["EURC", tokens.eurc]] as const).map(([k, v]) => (
              <div key={k} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-graphite">{k}</dt>
                <dd className="break-all font-mono text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-12 max-w-3xl text-sm text-graphite">
          Want to read what you are trusting? <Link href="/status" className={link}>The deployed contracts and their live checks</Link>.
        </p>
      </main>
      <PublicFooter />
    </div>
  );
}
