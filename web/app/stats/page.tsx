import type { Metadata } from "next";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { ProtocolNumbers } from "@/components/public/ProtocolNumbers";
import { CONTAINER } from "@/components/shell/container";
import { Callout } from "@/components/ui/Callout";
import { Lead, PageTitle } from "@/components/ui/Type";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { protocolStatsCached } from "@/lib/server/stats";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Network numbers",
  description: "What Symbolon's contracts have done on Arc, read from the chain.",
};

export default async function StatsPage() {
  const cfg = getConfig();
  const stats = await protocolStatsCached(await getDb(), getClient(), cfg.deployment);
  const network = `${stats.network.name}${stats.network.testnet ? " (a test network: no real money)" : ""}`;

  return (
    <div className="flex min-h-screen flex-col justify-between">
      <PublicHeader />
      <main id="main-content" className={`${CONTAINER} w-full flex-1 pb-14 pt-14`}>
        <PageTitle>Network numbers</PageTitle>
        <Lead className="mt-3">
          What Symbolon’s contracts have done on {network}. Every number is counted from the chain’s own events; nothing here comes from
          our accounts or our database of people.
        </Lead>

        {stats.state === "ready" ? (
          <>
            <p className="mt-6 text-sm text-graphite">
              Network: {stats.network.name}. Read through block {stats.readThrough}; the chain is at block {stats.head}.
            </p>
            <ProtocolNumbers stats={stats} />
          </>
        ) : stats.state === "collecting" ? (
          <Callout tone="neutral" className="mt-8">
            The history is still being collected from Arc{stats.readThrough ? ` (read through block ${stats.readThrough}${stats.head ? ` of ${stats.head}` : ""})` : ""}, so no number is shown
            yet. A partial count would be wrong, so there isn’t one.
          </Callout>
        ) : (
          <Callout tone="warn" className="mt-8">
            Can’t read Arc’s latest block right now, so these numbers can’t be confirmed. Try again in a moment.
          </Callout>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
