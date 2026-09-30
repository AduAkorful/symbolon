"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Business sidebar navigation. Only screens that exist are listed; later plans append their entries here when they
 * build the screen. Counts are shown only when a server value backs them — never from client state.
 *
 * On desktop: vertical list in the aside. On mobile: horizontally scrolling row pinned below the header.
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
  ];


  const isActive = (href: string) =>
    href === "/business" ? path === "/business" : path.startsWith(href);

  return (
    <nav aria-label="Business" className="overflow-x-auto md:overflow-x-visible">
      <ul className="flex gap-1 px-3 py-1 md:flex-col md:gap-0.5 md:py-2">
        {nav.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href} className="shrink-0 md:shrink">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between rounded-sm px-3 py-2 text-[15px] transition-colors duration-[var(--dur-quick)] ${
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
                    className={`ml-2 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums leading-none ${
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
