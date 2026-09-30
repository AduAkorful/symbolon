"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { name: "Home", href: "/vendor" },
  { name: "Invoices", href: "/vendor/invoices" },
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
    <nav aria-label="Vendor" className="order-3 w-full overflow-x-auto md:order-none md:w-auto">
      <ul className="flex gap-1">
        {nav.map((n) => {
          const active = isActive(path, n.href);
          return (
            <li key={n.href} className="shrink-0">
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-sm px-3 py-1.5 text-[15px] transition-colors duration-[var(--dur-quick)] ${active ? "bg-ink text-paper" : "text-ink/80 hover:bg-rule-soft/70"}`}
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
