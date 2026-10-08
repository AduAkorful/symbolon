"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ActivityFeed, ActivityItem } from "@/lib/server/activity";
import { TxLink } from "@/components/TxLink";
import { formatDateTime, formatDay, shortenAddressesIn } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chip";
import { controlClass } from "@/components/ui/Field";
import { EmptyState, InlineError, InlineLoading } from "@/components/ui/States";
import { Lead, PageTitle } from "@/components/ui/Type";

function formatActivityTime(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "Time unavailable";
  const sameUtcDay = (x: Date, y: Date) => formatDay(x, { year: "always" }) === formatDay(y, { year: "always" });
  const now = new Date();
  const timeStr = formatDateTime(d).split(", ").pop() ?? "";
  if (sameUtcDay(d, now)) return `Today ${timeStr}`;
  if (sameUtcDay(d, new Date(now.getTime() - 86_400_000))) return `Yesterday ${timeStr}`;
  return formatDateTime(d);
}

export function ActivityView({
  initialFeed,
  businessId,
  explorer,
}: {
  initialFeed: ActivityFeed;
  businessId: string;
  explorer: string;
}) {
  const [items, setItems] = useState<ActivityItem[]>(initialFeed.items);
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialFeed.nextCursor);
  const [who, setWho] = useState("All");
  const [vendor, setVendor] = useState("All vendors");
  const [budget, setBudget] = useState("All budgets");
  const [isPending, startTransition] = useTransition();
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchFiltered = (newWho: string, newVendor: string, newBudget: string) => {
    startTransition(async () => {
      const params = new URLSearchParams();
      if (newWho !== "All") params.set("who", newWho);
      if (newVendor !== "All vendors") params.set("vendor", newVendor);
      if (newBudget !== "All budgets") params.set("budget", newBudget);

      try {
        const res = await fetch(`/api/business/${businessId}/activity?${params.toString()}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setLoadError(null);
        setItems(data.items || []);
        setNextCursor(data.nextCursor);
      } catch {
        setLoadError("Couldn't load the activity. What's shown may be out of date; try again.");
      }
    });
  };

  const handleWhoChange = (newWho: string) => {
    setWho(newWho);
    fetchFiltered(newWho, vendor, budget);
  };

  const handleVendorChange = (newVendor: string) => {
    setVendor(newVendor);
    fetchFiltered(who, newVendor, budget);
  };

  const handleBudgetChange = (newBudget: string) => {
    setBudget(newBudget);
    fetchFiltered(who, vendor, newBudget);
  };

  const handleLoadMore = () => {
    if (!nextCursor) return;
    startTransition(async () => {
      const params = new URLSearchParams();
      if (who !== "All") params.set("who", who);
      if (vendor !== "All vendors") params.set("vendor", vendor);
      if (budget !== "All budgets") params.set("budget", budget);
      params.set("cursor", nextCursor);

      try {
        const res = await fetch(`/api/business/${businessId}/activity?${params.toString()}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setLoadError(null);
        setItems((prev) => [...prev, ...(data.items || [])]);
        setNextCursor(data.nextCursor);
      } catch {
        setLoadError("Couldn't load more activity. Try again.");
      }
    });
  };

  const filtered = who !== "All" || vendor !== "All vendors" || budget !== "All budgets";
  return (
    <div className="pb-24">
      <PageTitle>Activity</PageTitle>
      <Lead className="mt-3">One timeline of everything that happened to this business, from the Steward’s decisions to events on Arc.</Lead>

      {loadError ? <InlineError className="mt-4">{loadError}</InlineError> : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {initialFeed.whoOptions.map((w) => (
          <button key={w} type="button" aria-pressed={who === w} onClick={() => handleWhoChange(w)} className={chipClass(who === w)}>
            {w}
          </button>
        ))}

        <select aria-label="Vendor filter" value={vendor} onChange={(e) => handleVendorChange(e.target.value)} className={`${controlClass} sm:w-56`}>
          {initialFeed.vendorOptions.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        {initialFeed.budgetOptions.length > 1 ? (
          <select aria-label="Budget filter" value={budget} onChange={(e) => handleBudgetChange(e.target.value)} className={`${controlClass} sm:w-56`}>
            {initialFeed.budgetOptions.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        ) : null}
      </div>

      {isPending ? <InlineLoading className="mt-4">Updating the timeline…</InlineLoading> : null}

      {items.length ? (
        <ol className="mt-8 border-t border-ink">
          {items.map((e) => (
            <li key={e.id} className="grid gap-x-6 gap-y-1 border-b border-rule-soft py-3.5 md:grid-cols-[9.5rem_13rem_minmax(0,1fr)] md:items-baseline">
              <span className="text-sm text-graphite">{formatActivityTime(e.at)}</span>
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-graphite">
                <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${e.actor.kind === "steward" ? "bg-seal" : e.actor.kind === "vault" ? "bg-ink" : "bg-graphite"}`} />
                <span className="min-w-0 break-words" title={e.actor.label}>{shortenAddressesIn(e.actor.label)}</span>
              </span>
              <span className={`min-w-0 break-words text-sm ${e.tone === "red" ? "text-red" : e.tone === "seal" ? "font-medium text-seal" : "text-ink"}`}>
                {e.href ? <Link href={e.href} className="hover:underline">{shortenAddressesIn(e.what)}</Link> : shortenAddressesIn(e.what)}
                {e.tx ? (
                  <TxLink href={`${explorer}/tx/${e.tx}`} label={`Transaction ${e.tx}`} className="ml-3 text-graphite hover:text-ink">
                    {`${e.tx.slice(0, 6)}…${e.tx.slice(-4)}`}
                  </TxLink>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title={filtered ? "Nothing matches these filters" : "Nothing has happened yet"} className="mt-8">
          {filtered ? "Try a wider filter." : "Decisions, payments and changes to the Vault show up here as they happen."}
        </EmptyState>
      )}

      {nextCursor ? (
        <div className="mt-8 flex justify-center">
          <Button variant="secondary" busy={isPending} onClick={handleLoadMore}>
            {isPending ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
