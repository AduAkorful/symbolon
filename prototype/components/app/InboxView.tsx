"use client";

import Link from "next/link";
import { useState } from "react";
import { Money } from "@/components/Money";
import { invoices, type Trust } from "@/lib/acme";
import { usePause } from "./pause";
import { StatusTag, TrustTag } from "./tags";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/components/profile";

const filters: { key: "all" | Trust; label: string }[] = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "new", label: "New vendor" },
  { key: "unsigned", label: "Unsigned" },
];

export function InboxView() {
  const [filter, setFilter] = useState<"all" | Trust>("all");
  const { logoOf } = useProfile();
  const { paused } = usePause();
  const shown = invoices.filter((i) => filter === "all" || i.trust === filter);
  return (
    <main className="px-6 pb-20 pt-10 md:px-10">
      <div data-reveal className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Inbox</h1>
          <p className="mt-2 text-graphite">
            Sealed invoices from the network, and anything sent to <span className="font-mono text-ink">bills@acme.symbolon.xyz</span>.
          </p>
        </div>
        <div role="tablist" aria-label="Filter by trust" className="flex flex-wrap gap-2">
          {filters.map((f) => {
            const n = f.key === "all" ? invoices.length : invoices.filter((i) => i.trust === f.key).length;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors duration-[var(--dur-quick)] ${
                  filter === f.key ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink"
                }`}
              >
                {f.label} <span className="ml-1 opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div data-reveal className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[760px] border-t border-ink text-[15px]">
          <thead>
            <tr className="text-left text-xs text-graphite">
              <th className="py-3 pr-4 font-normal">Vendor</th>
              <th className="py-3 pr-4 font-normal">Trust</th>
              <th className="py-3 pr-4 font-normal">Invoice</th>
              <th className="py-3 pr-4 text-right font-normal">Amount</th>
              <th className="py-3 pr-4 font-normal">Due</th>
              <th className="py-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className="group border-t border-rule">
                <td className="py-0 pr-4">
                  <Link href={`/b/inbox/${i.id}`} className="flex items-center gap-3 py-3 font-medium group-hover:text-seal">
                    <Avatar name={i.vendor} src={logoOf(i.vendor)} show={i.trust === "verified"} size={28} />
                    {i.vendor}
                  </Link>
                </td>
                <td className="pr-4">
                  <TrustTag trust={i.trust} />
                </td>
                <td className="pr-4 font-mono text-sm text-graphite">{i.number}</td>
                <td className="pr-4 text-right">
                  <Money raw={i.amount} symbol="$" precise={false} tabular />
                </td>
                <td className="pr-4 text-graphite">{i.due}</td>
                <td>
                  <StatusTag status={i.status} paused={paused} />
                  <p className="text-xs text-graphite">{i.statusNote}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 ? <p className="mt-6 text-graphite">Nothing here. Invoices sealed by new vendors will show up in this view.</p> : null}
    </main>
  );
}
