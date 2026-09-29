import type { ReactNode } from "react";
import { DemoTag, Wordmark } from "@/components/Marks";

const accounts = [
  { name: "Home", count: null },
  { name: "Inbox", count: 3 },
  { name: "Approvals", count: 1 },
  { name: "Vendors", count: null },
  { name: "Orders", count: null },
  { name: "Treasury", count: null },
  { name: "Steward", count: null },
  { name: "Policy", count: null },
  { name: "Activity", count: null },
  { name: "Accounting", count: null },
];

/** The business app's frame: a ledger with the accounts down the left column rule */
export function Shell({ active, children }: { active: string; children: ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b border-rule md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-6 py-6 md:block">
          <Wordmark />
          <button className="mt-0 flex items-center gap-2 rounded-doc border border-rule px-3 py-2 text-left text-sm md:mt-7 md:w-full">
            <span className="grid h-6 w-6 place-items-center rounded-sm bg-ink font-display text-sm text-paper">A</span>
            <span className="flex-1">
              <span className="block font-medium leading-tight">Acme Operations</span>
              <span className="block text-xs text-graphite">Owner</span>
            </span>
          </button>
        </div>
        <nav aria-label="Accounts" className="hidden px-3 pb-6 md:block">
          <ul>
            {accounts.map((a) => (
              <li key={a.name}>
                <a
                  href="#"
                  aria-current={a.name === active ? "page" : undefined}
                  className={`flex items-center justify-between rounded-sm px-3 py-[7px] text-[15px] ${
                    a.name === active ? "bg-ink text-paper" : "text-ink/80 hover:bg-rule-soft/70"
                  }`}
                >
                  {a.name}
                  {a.count ? (
                    <span className={`tabular-nums text-xs ${a.name === active ? "text-paper/70" : "text-graphite"}`}>{a.count}</span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-rule px-6 py-4 md:px-10">
          <DemoTag className="mr-auto" />
          <span className="flex items-center gap-2 text-sm text-graphite">
            <span className="h-2 w-2 rounded-full bg-seal" />
            Steward: <span className="text-ink">Assisted</span>
          </span>
          <button className="rounded-doc border border-red/60 px-3.5 py-1.5 text-sm font-medium text-red hover:bg-red-wash">
            Pause payments
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
