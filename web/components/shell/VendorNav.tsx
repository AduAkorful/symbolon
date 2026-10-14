"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { name: "Home", href: "/vendor" },
  { name: "Invoices", href: "/vendor/invoices" },
  { name: "Upload", href: "/vendor/upload" },
  { name: "Series", href: "/vendor/series" },
  { name: "Clients", href: "/vendor/clients" },
  { name: "Checks", href: "/vendor/verify" },
  { name: "Settings", href: "/vendor/settings" },
];

const isActive = (path: string, href: string) => (href === "/vendor" ? path === "/vendor" : path.startsWith(href));

/** The vendor's top navigation (the screens that exist so far). The active screen is marked for assistive technology as well as sight. */
export function VendorNav() {
  const path = usePathname();
  return (
    <nav aria-label="Vendor" className="order-3 -mx-1 w-full min-[1440px]:order-none min-[1440px]:mx-0 min-[1440px]:w-auto">
      {/* one row at every width: it scrolls sideways on a phone instead of taking a second row (QA UI-v1, UI-v2) */}
      <ul className="flex gap-1 overflow-x-auto px-1 min-[1440px]:overflow-visible">
        {nav.map((n) => {
          const active = isActive(path, n.href);
          return (
            <li key={n.href} className="shrink-0">
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center border-b-2 px-3 py-2 text-sm transition-colors duration-[var(--dur-quick)] ${active ? "border-ink font-medium text-ink" : "border-transparent text-ink/70 hover:text-ink"}`}
              >
                {n.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
