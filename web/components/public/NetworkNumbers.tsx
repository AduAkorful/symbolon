"use client";

import { useEffect, useState } from "react";
import { ProtocolNumbers } from "@/components/public/ProtocolNumbers";
import { CONTAINER } from "@/components/shell/container";
import type { ProtocolStats } from "@/lib/server/stats";

/**
 * What Symbolon's contracts have done on Arc, on the landing page (plan 05zc §2). It asks the API after the page loads, so the
 * landing page itself stays static. Every number is counted from the chain's own events and named with its network and block.
 * While the history is still being read it says how far along that is and shows no number (a partial count would be wrong);
 * when Arc can't be read it draws nothing.
 */
export function NetworkNumbers() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/stats", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<ProtocolStats>) : null))
        .then((s) => {
          if (!live) return;
          setStats(s);
          // while it is being collected, look again: each look also moves the collection forward
          if (s?.state === "collecting") timer = setTimeout(load, 15_000);
        })
        .catch(() => live && setStats(null));
    let timer: ReturnType<typeof setTimeout> | undefined;
    void load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!stats || stats.state === "unconfirmed") return null;
  const where = `${stats.network.name}${stats.network.testnet ? ", a test network with no real money" : ""}`;

  return (
    <section aria-labelledby="network-numbers" className="border-y border-rule">
      <div className={`${CONTAINER} py-14`}>
        <h2 id="network-numbers" className="font-display text-3xl leading-snug">What the contracts have done so far</h2>
        {stats.state === "ready" ? (
          <>
            <p className="mt-2 max-w-[62ch] text-sm text-graphite">
              Counted from Arc’s own events, nothing from our accounts. Network: {where}. Read through block {stats.readThrough}.
            </p>
            <ProtocolNumbers stats={stats} />
          </>
        ) : (
          <p role="status" className="mt-2 max-w-[62ch] text-sm text-graphite">
            Reading the history from {where}{stats.progressPercent !== null ? `: ${stats.progressPercent}% done` : ""}. The numbers appear when every
            block has been read, because a partial count would be wrong.
          </p>
        )}
      </div>
    </section>
  );
}
