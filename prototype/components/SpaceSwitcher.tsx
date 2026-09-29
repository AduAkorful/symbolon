"use client";

import Link from "next/link";
import { useProfile } from "@/components/profile";
import { Avatar } from "@/components/Avatar";
import { useEffect, useRef, useState } from "react";

const spaces = [
  { key: "vendor", href: "/v", mark: "S", name: "Studio Ana", role: "Your Seal · @studio-ana" },
  { key: "acme", href: "/b", mark: "A", name: "Acme Operations", role: "Owner" },
] as const;

/** Switch between "my Seal" and each business you belong to (A2). One person can be both. */
export function SpaceSwitcher({ current, compact = false }: { current: "vendor" | "acme"; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cur = spaces.find((s) => s.key === current)!;
  const { vendorLogo, businessLogo } = useProfile();
  // Your own accounts always show your own logos
  const logoFor = (key: string) => (key === "vendor" ? vendorLogo : businessLogo);

  // Opening puts the keyboard on the current account, so arrows, Enter and Escape all work without the mouse
  useEffect(() => {
    if (!open) return;
    const items = ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]");
    (items ? Array.from(items).find((i) => i.dataset.current === "true") ?? items[0] : undefined)?.focus();
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Home") items[0]?.focus();
    else if (e.key === "End") items[items.length - 1]?.focus();
    else if (e.key === "Escape") {
      setOpen(false);
      trigger.current?.focus();
    } else return;
    e.preventDefault();
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (e instanceof MouseEvent && !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={trigger}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 rounded-doc border border-rule px-3 py-2 text-left text-sm hover:border-ink/50 ${compact ? "" : "md:w-full"}`}
      >
        <Avatar name={cur.name} src={logoFor(cur.key)} size={24} />
        <span className="flex-1">
          <span className="block font-medium leading-tight">{cur.name}</span>
          {!compact ? <span className="hidden text-xs text-graphite md:block">{cur.role}</span> : null}
        </span>
        <span aria-hidden className="text-graphite">
          ▾
        </span>
      </button>
      {open ? (
        // Same width as the button it hangs from, so it stays inside the sidebar instead of covering the page.
        // It arrives with the motion system's quick "arrive": a short fade and drop from the button.
        <div
          role="menu"
          aria-label="Switch account"
          onKeyDown={onMenuKey}
          className={`menu-in absolute left-0 right-0 top-full z-50 mt-1.5 origin-top rounded-doc border border-rule bg-paper-raised p-1.5 shadow-xl ${compact ? "min-w-[15rem]" : ""}`}
        >
          {spaces.map((s) => (
            <Link
              key={s.key}
              role="menuitem"
              href={s.href}
              data-current={s.key === current}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-sm px-2.5 py-2 text-sm outline-none hover:bg-rule-soft/70 focus-visible:bg-rule-soft/70 focus-visible:ring-2 focus-visible:ring-seal ${s.key === current ? "bg-rule-soft/50" : ""}`}
            >
              <Avatar name={s.name} src={logoFor(s.key)} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block truncate text-xs text-graphite">{s.role}</span>
              </span>
              {s.key === current ? <span aria-label="Current account" className="text-seal">✓</span> : null}
            </Link>
          ))}
          <Link
            role="menuitem"
            href="/setup"
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-sm border-t border-rule px-2.5 pb-1.5 pt-2.5 text-sm text-graphite outline-none hover:text-ink focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-seal"
          >
            Set up a business
          </Link>
          <Link
            role="menuitem"
            href={current === "vendor" ? "/v/profile" : "/b/profile"}
            onClick={() => setOpen(false)}
            className="block rounded-sm px-2.5 py-1.5 text-sm text-graphite outline-none hover:text-ink focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-seal"
          >
            Your profile
          </Link>
        </div>
      ) : null}
    </div>
  );
}
