import type { Metadata } from "next";
import { explorerAddressUrl } from "@symbolon/chain";
import { Reveal } from "@/components/Reveal";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { CONTAINER } from "@/components/shell/container";
import { getClient } from "@/lib/server/chain";
import { readChainStatus } from "@/lib/server/chain-status";
import { getConfig } from "@/lib/server/config";

// Every request reads the chain; nothing here may be served from a cache
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contract Status",
  description: "Live onchain verification and deployment health of Symbolon contracts on Arc testnet.",
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default async function StatusPage() {
  const config = getConfig();
  const status = await readChainStatus(getClient(), config.deployment);
  const failed = status.checks.filter((c) => !c.ok);

  return (
    <div className="min-h-screen flex flex-col justify-between">
      <PublicHeader />
      <main id="main-content" className={`${CONTAINER} w-full flex-1 pb-14 pt-14`}>
      <Reveal>
        <h1 data-reveal className="font-display text-4xl leading-tight md:text-5xl">
          {status.ok ? "Connected to the deployed contracts." : "Can’t confirm the chain right now."}
        </h1>
        <p data-reveal className="mt-3 text-graphite">
          {status.ok
            ? `Release ${config.deployment.releaseVersion}. Read at block ${status.block}, ${status.readAt.toISOString().slice(11, 19)} UTC.`
            : `${failed.length} of ${status.checks.length} checks failed. Nothing on this page should be trusted until they pass.`}
        </p>

        <ul data-reveal className="mt-10 max-w-3xl border-t border-rule" aria-label="Contract health checks">
          {status.checks.map((c) => (
            <li key={c.name} className="grid grid-cols-[1.25rem_10rem_1fr] items-baseline gap-x-3 border-b border-rule-soft py-3 text-sm">
              <span className={c.ok ? "text-seal" : "text-red"} aria-label={c.ok ? "Passed" : "Failed"}>
                {c.ok ? "✓" : "✕"}
              </span>
              <span>{c.name}</span>
              <span className={`flex flex-wrap items-baseline gap-x-3 ${c.ok ? "text-graphite" : "text-red"}`}>
                <span>{c.detail}</span>
                {c.address ? (
                  <a href={explorerAddressUrl(config.chainId, c.address)} className="font-mono text-sm underline decoration-rule underline-offset-4">
                    {short(c.address)}
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Reveal>
      </main>
      <PublicFooter />
    </div>
  );
}
