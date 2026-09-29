"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { name: "Home", href: "/v" },
  { name: "Invoices", href: "/v/invoices" },
  { name: "Clients", href: "/v/clients" },
  { name: "Checks", href: "/v/verify" },
  { name: "Settings", href: "/v/settings" },
];

const isActive = (path: string, href: string) => (href === "/v" ? path === "/v" : path.startsWith(href));

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
