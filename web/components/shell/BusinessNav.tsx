"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Business sidebar navigation. Only screens that exist are listed; later plans append their entries here when they
 * build the screen. Counts are shown only when a server value backs them — never from client state.
 *
 * On desktop: vertical list in the aside. On a phone: one "Menu" button showing where you are; it opens the whole list, so
 * no entry is hidden off the edge of a strip.
 */
export function BusinessNav({
  inboxCount,
  approvalsCount,
  hasReleaseNudge,
}: {
  inboxCount?: number;
  approvalsCount?: number;
  hasReleaseNudge?: boolean;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  // moving to another screen closes the phone menu
  useEffect(() => {
    setOpen(false);
  }, [path]);

  const nav: { name: string; href: string; count?: number; hasDot?: boolean }[] = [

    { name: "Home", href: "/business" },
    { name: "Inbox", href: "/business/inbox", count: inboxCount },
    { name: "Approvals", href: "/business/approvals", count: approvalsCount },
    { name: "Treasury", href: "/business/treasury" },
    { name: "Vendors", href: "/business/vendors" },
    { name: "Orders", href: "/business/orders" },
    { name: "Steward", href: "/business/steward" },
    { name: "Activity", href: "/business/activity" },
    { name: "Accounting", href: "/business/accounting" },
    { name: "Compliance", href: "/business/compliance" },
    { name: "Team", href: "/business/team" },
    { name: "Policy", href: "/business/policy" },
    { name: "Settings", href: "/business/settings", hasDot: hasReleaseNudge },
    { name: "Ask the Steward", href: "/business/ask" },
  ];


  const isActive = (href: string) =>
    href === "/business" ? path === "/business" : path.startsWith(href);

  const here = nav.find((item) => isActive(item.href))?.name ?? "Menu";

  return (
    <nav aria-label="Business">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="business-nav-list"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between border-t border-rule min-h-11 px-6 py-3 text-left text-base lg:hidden"
      >
        <span>
          <span className="text-graphite">Menu · </span>
          <span className="font-medium">{here}</span>
        </span>
        <span aria-hidden className="text-graphite">{open ? "▴" : "▾"}</span>
      </button>
      <ul id="business-nav-list" className={`${open ? "flex" : "hidden"} flex-col gap-0.5 px-3 py-2 lg:flex`}>
        {nav.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center justify-between rounded-doc px-3 py-2 text-sm transition-colors duration-[var(--dur-quick)] ${
                  active ? "bg-ink text-paper" : "text-ink/80 hover:bg-rule-soft/70"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span>{item.name}</span>
                  {item.hasDot ? (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-seal"
                      aria-label="Release update available"
                    />
                  ) : null}
                </span>
                {item.count !== undefined && item.count > 0 ? (

                  <span
                    aria-label={`${item.count} item${item.count === 1 ? "" : "s"}`}
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium leading-none ${
                      active ? "bg-paper/20 text-paper" : "bg-ink/10 text-ink"
                    }`}
                  >
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
