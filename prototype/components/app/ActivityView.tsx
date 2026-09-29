"use client";

import Link from "next/link";
import { useState } from "react";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/components/profile";

type Who = "Steward" | "You" | "Ama" | "Dele" | "Vault";
const events: { time: string; who: Who; what: string; vendor?: string; budget?: string; href?: string; tone?: "seal" | "red"; tx?: string }[] = [
  { time: "Today 14:02", who: "Steward", what: "Recommended accepting Northwind’s 1.2% cash-now offer", vendor: "Northwind Agency", budget: "Marketing", href: "/b/decisions/d-1402", tone: "seal" },
  { time: "Today 11:31", who: "Steward", what: "Moved $22,000.00 of idle cash into the reserve", href: "/b/decisions/d-1131", tx: tx.sweep },
  { time: "Today 11:30", who: "Vault", what: "Received $40,000.00 from Halden Retail", tx: tx.deposit },
  { time: "Today 11:02", who: "Vault", what: "Northwind Agency asked to change its payout address; 72-hour cooldown started", vendor: "Northwind Agency", tone: "red" },
  { time: "Today 10:05", who: "Steward", what: "Refused an unsealed email claiming to be Studio Ana", vendor: "Studio Ana", href: "/b/decisions/d-1005", tone: "red" },
  { time: "Today 09:40", who: "Steward", what: "Held Forge Supply F-778: delivery not confirmed; asked Dele", vendor: "Forge Supply", budget: "Operations", href: "/b/decisions/d-0940", tone: "red" },
  { time: "Today 09:13", who: "Vault", what: "Refused a retry of 0143: already paid", vendor: "Studio Ana", budget: "Design", href: "/b/decisions/d-0913", tone: "red" },
  { time: "Today 09:12", who: "Steward", what: "Paid Studio Ana $1,985.00 for retainer 0143, 0.75% early", vendor: "Studio Ana", budget: "Design", href: "/b/decisions/d-0912", tone: "seal", tx: tx.payAna },
  { time: "Yesterday 17:20", who: "Ama", what: "Approved Halden Freight 88-12, $4,100.00", vendor: "Halden Freight", budget: "Operations" },
  { time: "Yesterday 16:05", who: "Dele", what: "Raised PO-0050 with Kestrel Labs, up to $5,200.00", vendor: "Kestrel Labs", budget: "Engineering" },
  { time: "24 Sep", who: "You", what: "Raised the auto-pay limit to $2,500.00 (applied after 24 h)", tx: tx.policyApply },
];

const whoFilters: ("All" | Who)[] = ["All", "Steward", "You", "Ama", "Dele", "Vault"];

/** Activity (B19): one timeline of everything, filterable by person, vendor or budget */
export function ActivityView() {
  const [who, setWho] = useState<"All" | Who>("All");
  const { photos } = useProfile();
  const [vendor, setVendor] = useState("All vendors");
  const [budget, setBudget] = useState("All budgets");
  const vendors = ["All vendors", ...new Set(events.flatMap((e) => (e.vendor ? [e.vendor] : [])))];
  const budgets = ["All budgets", ...new Set(events.flatMap((e) => (e.budget ? [e.budget] : [])))];
  const shown = events.filter((e) => (who === "All" || e.who === who) && (vendor === "All vendors" || e.vendor === vendor) && (budget === "All budgets" || e.budget === budget));
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Activity
      </h1>
      <div data-reveal className="mt-6 flex flex-wrap items-center gap-2">
        {whoFilters.map((w) => (
          <button key={w} aria-pressed={who === w} onClick={() => setWho(w)} className={`rounded-full border px-3 py-1 text-sm ${who === w ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink"}`}>
            {w}
          </button>
        ))}
        <select aria-label="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} className="rounded-doc border border-rule bg-paper px-3 py-1.5 text-sm">
          {vendors.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select aria-label="Budget" value={budget} onChange={(e) => setBudget(e.target.value)} className="rounded-doc border border-rule bg-paper px-3 py-1.5 text-sm">
          {budgets.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </div>
      <ol data-reveal className="mt-8 border-t border-ink">
        {shown.map((e) => (
          <li key={e.time + e.what} className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[9rem_6rem_1fr]">
            <span className="font-mono text-xs text-graphite">{e.time}</span>
            <span className="flex items-center gap-2 text-sm text-graphite">
              <Avatar name={e.who === "You" ? "Ana Ferreira" : e.who} src={photos[e.who]} size={22} letters={e.who === "Ama" || e.who === "Dele" || e.who === "You" ? 2 : 1} />
              {e.who}
            </span>
            <span className={e.tone === "red" ? "text-red" : ""}>
              {e.href ? (
                <Link href={e.href} className="hover:underline">
                  {e.what}
                </Link>
              ) : (
                e.what
              )}
              {e.tx ? (
                <TxLink hash={e.tx} className="ml-3">
                  {e.tx}
                </TxLink>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {!shown.length ? <p className="mt-6 text-graphite">Nothing matches these filters.</p> : null}
    </main>
  );
}
