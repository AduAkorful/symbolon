"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ActivityFeed, ActivityItem } from "@/lib/server/activity";
import { TxLink } from "@/components/TxLink";

function formatActivityTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `Today ${timeStr}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return `Yesterday ${timeStr}`;

    return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${timeStr}`;
  } catch {
    return isoString;
  }
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

  const fetchFiltered = (newWho: string, newVendor: string, newBudget: string) => {
    startTransition(async () => {
      const params = new URLSearchParams();
      if (newWho !== "All") params.set("who", newWho);
      if (newVendor !== "All vendors") params.set("vendor", newVendor);
      if (newBudget !== "All budgets") params.set("budget", newBudget);

      try {
        const res = await fetch(`/api/business/${businessId}/activity?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setItems(data.items || []);
          setNextCursor(data.nextCursor);
        }
      } catch {
        // fallback
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
        if (res.ok) {
          const data = await res.json();
          setItems((prev) => [...prev, ...(data.items || [])]);
          setNextCursor(data.nextCursor);
        }
      } catch {
        // ignore
      }
    });
  };

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl md:text-5xl">Activity</h1>
          <p className="mt-2 text-sm text-graphite">
            One timeline of everything that happened to this business, from decisions to chain events.
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {initialFeed.whoOptions.map((w) => (
          <button
            key={w}
            type="button"
            aria-pressed={who === w}
            onClick={() => handleWhoChange(w)}
            className={`rounded-full border px-3 py-1 text-xs md:text-sm transition-colors ${
              who === w
                ? "border-ink bg-ink text-paper"
                : "border-rule text-ink hover:border-ink"
            }`}
          >
            {w}
          </button>
        ))}

        <select
          aria-label="Vendor filter"
          value={vendor}
          onChange={(e) => handleVendorChange(e.target.value)}
          className="rounded-sm border border-rule bg-paper px-3 py-1 text-sm text-ink outline-none hover:border-ink"
        >
          {initialFeed.vendorOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        {initialFeed.budgetOptions.length > 1 ? (
          <select
            aria-label="Budget filter"
            value={budget}
            onChange={(e) => handleBudgetChange(e.target.value)}
            className="rounded-sm border border-rule bg-paper px-3 py-1 text-sm text-ink outline-none hover:border-ink"
          >
            {initialFeed.budgetOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {isPending ? (
        <p className="mt-4 text-xs font-mono text-graphite">Updating activity feed…</p>
      ) : null}

      <ol className="mt-8 border-t border-ink">
        {items.map((e) => (
          <li
            key={e.id}
            className="grid gap-1 border-b border-rule py-3.5 sm:grid-cols-[10rem_7rem_1fr] sm:items-baseline"
          >
            <span className="font-mono text-xs text-graphite">{formatActivityTime(e.at)}</span>
            <span className="flex items-center gap-2 text-sm font-medium text-graphite">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  e.actor.kind === "steward"
                    ? "bg-seal"
                    : e.actor.kind === "vault"
                      ? "bg-ink"
                      : "bg-graphite"
                }`}
                aria-hidden="true"
              />
              <span className="truncate" title={e.actor.label}>
                {e.actor.label}
              </span>
            </span>
            <span className={`text-sm ${e.tone === "red" ? "text-red" : e.tone === "seal" ? "text-seal font-medium" : "text-ink"}`}>
              {e.href ? (
                <Link href={e.href} className="hover:underline">
                  {e.what}
                </Link>
              ) : (
                e.what
              )}
              {e.tx ? (
                <TxLink
                  href={`${explorer}/tx/${e.tx}`}
                  label={`Transaction ${e.tx}`}
                  className="ml-3 font-mono text-xs text-graphite hover:text-ink"
                >
                  {`${e.tx.slice(0, 6)}…${e.tx.slice(-4)}`}
                </TxLink>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      {!items.length ? (
        <div className="mt-12 rounded-sm border border-dashed border-rule p-8 text-center">
          <p className="text-sm text-graphite">
            {who !== "All" || vendor !== "All vendors" || budget !== "All budgets"
              ? "Nothing matches these filters."
              : "Nothing has happened yet."}
          </p>
        </div>
      ) : null}

      {nextCursor ? (
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isPending}
            className="rounded-sm border border-rule px-4 py-2 text-sm text-ink hover:border-ink disabled:opacity-50"
          >
            {isPending ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </main>
  );
}
