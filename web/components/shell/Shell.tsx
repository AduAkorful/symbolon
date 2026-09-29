import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Marks";
import { PrivyBoundary } from "@/components/providers/PrivyBoundary";
import { getConfig } from "@/lib/server/config";
import type { Where } from "@/lib/server/space";
import { SpaceSwitcher, type Current } from "./SpaceSwitcher";
import { VendorNav } from "./VendorNav";

const pill = "rounded-full border border-rule px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite";

/**
 * The frame around a signed-in space: the wordmark, the space switcher and the way out. Business screens get the
 * sidebar the prototype has; a vendor's are a top bar. Navigation entries arrive with the screens they open.
 */
export function Shell(props: { where: Where; current: Current; children: ReactNode }) {
  return (
    <PrivyBoundary>
      <Frame {...props} />
    </PrivyBoundary>
  );
}

function Frame({ where, current, children }: { where: Where; current: Current; children: ReactNode }) {
  const testnet = getConfig().testnet;
  const chain = <span className={pill}>{testnet ? "Arc testnet" : "Arc mainnet"}</span>;

  if (current.kind === "vendor")
    return (
      <div className="min-h-screen">
        <header className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-8 gap-y-3 border-b border-rule px-6 py-4 md:px-10">
          <Link href="/vendor" aria-label="Symbolon home">
            <Wordmark />
          </Link>
          {where.spaces.seal ? <VendorNav /> : null}
          <div className="ml-auto flex items-center gap-3">
            {chain}
            {where.spaces.seal ? (
              <Link href="/vendor/new" className="hidden rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper sm:inline-block">
                New invoice
              </Link>
            ) : null}
            <SpaceSwitcher spaces={where.spaces} current={current} who={where.who} compact />
          </div>
        </header>
        <main className="mx-auto max-w-[1180px] px-6 py-10 md:px-10">{children}</main>
      </div>
    );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b border-rule md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-6 py-5 md:block md:px-3 md:py-6">
          <Link href="/business" aria-label="Symbolon home" className="md:block md:px-3">
            <Wordmark />
          </Link>
          <div className="md:mt-7">
            <SpaceSwitcher spaces={where.spaces} current={current} who={where.who} />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-end gap-3 border-b border-rule px-6 py-4 md:px-10">{chain}</header>
        <main className="px-6 py-10 md:px-10">{children}</main>
      </div>
    </div>
  );
}
