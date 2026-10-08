"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONTAINER } from "@/components/shell/container";
import type { ProtocolStats } from "@/lib/server/stats";

const WHOLE = new Intl.NumberFormat("en-US");

/**
 * One line of chain-derived numbers on the landing page (plan 05zc §2). It asks the API after the page loads, so the landing page
 * itself stays static. It draws nothing while the history is still being collected or when the numbers can't be confirmed: a
 * landing page doesn't announce what it can't prove, and /stats says why.
 */
export function ProtocolStatsStrip() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/stats")
      .then((r) => (r.ok ? (r.json() as Promise<ProtocolStats>) : null))
      .then((s) => live && setStats(s))
      .catch(() => live && setStats(null));
    return () => {
      live = false;
    };
  }, []);
  const n = stats?.state === "ready" ? stats.numbers : null;
  if (!stats || !n) return null;
  return (
    <section aria-label="Network numbers" className="border-y border-rule">
      <p className={`${CONTAINER} flex flex-wrap items-baseline gap-x-6 gap-y-1 py-4 text-sm text-graphite`}>
        <span className="text-ink">On {stats.network.name}{stats.network.testnet ? ", a test network" : ""}, read through block {stats.readThrough}:</span>
        <span>{WHOLE.format(n.invoicesSettled)} {n.invoicesSettled === 1 ? "invoice" : "invoices"} settled</span>
        <span>{WHOLE.format(n.vaultsCreated)} {n.vaultsCreated === 1 ? "Vault" : "Vaults"} created</span>
        <Link href="/stats" className="underline decoration-rule underline-offset-4 hover:text-ink">All network numbers</Link>
      </p>
    </section>
  );
}
