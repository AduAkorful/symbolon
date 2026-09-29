"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DemoTag, Wordmark } from "@/components/Marks";
import { SpaceSwitcher } from "@/components/SpaceSwitcher";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/components/profile";

const nav = [
  { name: "Home", href: "/v" },
  { name: "Invoices", href: "/v/invoices" },
  { name: "Clients", href: "/v/clients" },
  { name: "Series", href: "/v/series" },
  { name: "Settings", href: "/v/settings" },
];

const isActive = (path: string, href: string) => (href === "/v" ? path === "/v" : path.startsWith(href));

/** The vendor app's frame: lighter than the business app, one clear action (new invoice) */
export function VendorShell({ children }: { children: ReactNode }) {
  const { photos } = useProfile();
  const path = usePathname();
  if (path.startsWith("/v/start")) return <>{children}</>;
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4 md:px-10">
          <Link href="/v" aria-label="Symbolon home">
            <Wordmark />
          </Link>
          <nav aria-label="Vendor" className="order-3 w-full overflow-x-auto md:order-none md:w-auto">
            <ul className="flex gap-1">
              {nav.map((n) => {
                const active = isActive(path, n.href);
                return (
                  <li key={n.href} className="shrink-0">
                    <Link
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-sm px-3 py-1.5 text-[15px] transition-colors duration-[var(--dur-quick)] ${
                        active ? "bg-ink text-paper" : "text-ink/80 hover:bg-rule-soft/70"
                      }`}
                    >
                      {n.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <DemoTag className="hidden sm:inline-flex" />
            <div className="hidden sm:block">
              <SpaceSwitcher current="vendor" compact />
            </div>
            <Link href="/v/new" className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
              New invoice
            </Link>
            <Link href="/v/profile" aria-label="Your profile" title="Your profile" className="rounded-sm focus-visible:ring-2 focus-visible:ring-seal">
              <Avatar name="Ana Ferreira" src={photos["You"]} size={34} letters={2} />
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1180px]">{children}</div>
    </div>
  );
}
