"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { DemoTag, Wordmark } from "@/components/Marks";
import { SpaceSwitcher } from "@/components/SpaceSwitcher";
import { TxLink } from "@/components/TxLink";
import { E, registerMotion } from "@/lib/motion";
import { usePause } from "./pause";
import { useRelease } from "./release";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/components/profile";

const accounts = [
  { name: "Home", href: "/b", count: null },
  { name: "Inbox", href: "/b/inbox", count: 3 },
  { name: "Approvals", href: "/b/approvals", count: 1 },
  { name: "Vendors", href: "/b/vendors", count: null },
  { name: "Orders", href: "/b/orders", count: null },
  { name: "Treasury", href: "/b/treasury", count: null },
  { name: "Steward", href: "/b/steward", count: null },
  { name: "Policy", href: "/b/policy", count: null },
  { name: "Activity", href: "/b/activity", count: null },
  { name: "Accounting", href: "/b/accounting", count: null },
  { name: "Compliance", href: "/b/compliance", count: null },
  { name: "Team", href: "/b/team", count: null },
  { name: "Settings", href: "/b/settings", count: null },
];

const isActive = (path: string, href: string) => (href === "/b" ? path === "/b" : path.startsWith(href));

/** The business app's frame: accounts down the left, the pause control always in reach */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { paused, setPaused, lastTx, clearTx } = usePause();
  const release = useRelease();
  const { photos } = useProfile();
  const rule = useRef<HTMLDivElement>(null);

  // Pause draws a red rule across the top (storyboard: guardrails, beat 3)
  useLayoutEffect(() => {
    if (!paused || !rule.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const t = gsap.from(rule.current, { scaleX: 0, duration: 0.4, ease: E("settle") });
    return () => {
      t.revert();
    };
  }, [paused]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      {paused ? <div ref={rule} className="fixed inset-x-0 top-0 z-50 h-1.5 origin-left bg-red" aria-hidden /> : null}
      <aside className="border-b border-rule md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-6 py-5 md:block md:px-3 md:py-6">
          <Link href="/b" aria-label="Symbolon home" className="md:block md:px-3">
            <Wordmark />
          </Link>
          <div className="md:mt-7">
            <SpaceSwitcher current="acme" />
          </div>
        </div>
        <nav aria-label="Accounts" className="overflow-x-auto px-3 pb-3 md:pb-6">
          <ul className="flex gap-1 md:block">
            {accounts.map((a) => {
              const active = isActive(path, a.href);
              // A waiting Vault release is one thing for the owner to look at in Settings
              const count = a.name === "Settings" && release.state !== "applied" ? 1 : a.count;
              return (
                <li key={a.name} className="shrink-0">
                  <Link
                    href={a.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between gap-3 rounded-sm px-3 py-[7px] text-[15px] transition-colors duration-[var(--dur-quick)] ${
                      active ? "bg-ink text-paper" : "text-ink/80 hover:bg-rule-soft/70"
                    }`}
                  >
                    {a.name}
                    {count ? (
                      <span className={`text-xs tabular-nums ${active ? "text-paper/70" : "text-graphite"}`}>{count}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className={`min-w-0 transition-[filter] duration-[var(--dur-arrive)] ${paused ? "saturate-[0.55]" : ""}`}>
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-rule px-6 py-4 md:px-10">
          <DemoTag className="mr-auto" />
          <Link href="/b/ask" className="rounded-doc border border-rule px-3 py-1.5 text-sm hover:border-ink">
            Ask the Steward
          </Link>
          <span className="flex items-center gap-2 text-sm text-graphite">
            <span className={`h-2 w-2 rounded-full ${paused ? "bg-red" : "bg-seal"}`} />
            Steward: <span className={paused ? "text-red" : "text-ink"}>{paused ? "Paused" : "Assisted"}</span>
          </span>
          <Link href="/b/profile" aria-label="Your profile" title="Your profile" className="order-last rounded-sm focus-visible:ring-2 focus-visible:ring-seal">
            <Avatar name="Ana Ferreira" src={photos["You"]} size={34} letters={2} />
          </Link>
          {paused ? (
            <button
              onClick={() => setPaused(false)}
              className="rounded-doc bg-red px-3.5 py-1.5 text-sm font-medium text-paper"
            >
              Resume payments
            </button>
          ) : (
            <button
              onClick={() => setPaused(true)}
              className="rounded-doc border border-red/60 px-3.5 py-1.5 text-sm font-medium text-red hover:bg-red-wash"
            >
              Pause payments
            </button>
          )}
        </header>
        {paused ? (
          <p role="status" className="border-b border-red/40 bg-red-wash px-6 py-2.5 text-sm text-red md:px-10">
            Payments are paused. The Steward can’t pay, and nothing scheduled goes out until you resume. Nothing else changed.{" "}
            {lastTx?.kind === "pause" ? <TxLink hash={lastTx.hash}>Transaction {lastTx.hash}</TxLink> : null}
          </p>
        ) : lastTx?.kind === "resume" ? (
          <p role="status" className="flex flex-wrap items-baseline gap-x-3 border-b border-seal/40 bg-seal-wash/50 px-6 py-2.5 text-sm md:px-10">
            <span>Payments resumed.</span>
            <TxLink hash={lastTx.hash}>Transaction {lastTx.hash}</TxLink>
            <button onClick={clearTx} className="ml-auto text-graphite underline decoration-rule underline-offset-4">
              Dismiss
            </button>
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}
