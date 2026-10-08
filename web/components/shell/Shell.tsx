import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Marks";
import { PrivyBoundary } from "@/components/providers/PrivyBoundary";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { getSession } from "@/lib/server/http";
import type { Where } from "@/lib/server/space";
import { loadNavCounts, type NavCounts } from "@/lib/server/nav-counts";

import { buttonClass } from "@/components/ui/button";

import { BusinessNav } from "./BusinessNav";
import { CONTAINER } from "./container";

import { Avatar } from "@/components/Avatar";
import { Bell } from "@/components/notifications/Bell";
import { getUnreadNotificationCount } from "@/lib/server/notifications";
import { SpaceSwitcher, type Current } from "./SpaceSwitcher";
import { VendorNav } from "./VendorNav";
import { PausedRule, PausedSlots, PauseSlot, ReleaseDotSlot, StewardChipSlot } from "./VaultSlots";

const pill = "rounded-full border border-rule px-2.5 py-1 font-mono text-xs uppercase tracking-[0.14em] text-graphite";

/**
 * The frame around a signed-in space: the wordmark, the space switcher and the way out. Business screens get the
 * sidebar the prototype has (with BusinessNav); a vendor's are a top bar. Navigation entries arrive with the screens
 * they open.
 *
 * For business screens: shows the live Steward status, pause banner & red rule when paused, and owner pause control (S13).
 */
export async function Shell(props: {
  where: Where;
  current: Current;
  children: ReactNode;
  unreadCount?: number;
}) {
  return (
    <PrivyBoundary>
      <Frame {...props} />
    </PrivyBoundary>
  );
}

async function Frame({
  where,
  current,
  children,
  unreadCount: initialUnreadCount,
}: {
  where: Where;
  current: Current;
  children: ReactNode;
  unreadCount?: number;
}) {
  const config = getConfig();
  const testnet = config.testnet;
  const chain = <span className={pill}>{testnet ? "Arc testnet" : "Arc mainnet"}</span>;

  let unreadCount = initialUnreadCount;
  if (unreadCount === undefined) {
    try {
      const session = await getSession();
      if (session) {
        const db = await getDb();
        unreadCount = await getUnreadNotificationCount(db, session.user.id);
      }
    } catch (e) {
      console.error("unread notification count failed", e);
      unreadCount = undefined;
    }
  }

  if (current.kind === "vendor") {
    return (
      <div className="min-h-screen">
        <header className="border-b border-rule">
          <div className={`${CONTAINER} flex flex-wrap items-center gap-x-6 gap-y-2 py-3 lg:flex-nowrap`}>
            <Link href="/vendor" aria-label="Symbolon home" className="shrink-0">
              <Wordmark />
            </Link>
            {where.spaces.seal ? <VendorNav /> : null}
            <div className="ml-auto flex shrink-0 items-center gap-3">
              <span className="hidden xl:inline-block">{chain}</span>
              {where.spaces.seal ? (
                <Link href="/vendor/new" className={buttonClass({ size: "sm", className: "hidden sm:inline-flex" })}>
                  New invoice
                </Link>
              ) : null}
              <Bell unreadCount={unreadCount ?? 0} />
              <SpaceSwitcher spaces={where.spaces} current={current} who={where.who} compact />
            </div>
          </div>
        </header>
        {/* id="main-content" lets the skip-link jump here and lets Overlay make this inert while a dialog is open */}
        <main id="main-content" className={`${CONTAINER} py-10`}>{children}</main>
      </div>
    );
  }

  // Business shell: S13 status, pause banner, and controls
  const biz = current.id
    ? (where.business?.id === current.id ? where.business : where.spaces.businesses.find((b) => b.id === current.id))
    : where.business;

  let navCounts: NavCounts | undefined;
  if (biz?.id) {
    try {
      navCounts = await loadNavCounts(await getDb(), biz.id);
    } catch (e) {
      // the menu shows no number rather than a wrong one
      console.error("navigation counts failed", e);
    }
  }

  return (
    <div className="relative min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      {/* S13: red rule across the top while payments are paused; it arrives with the Vault read and is laid over the page, so it moves nothing */}
      <PausedRule biz={biz} />

      <aside className="border-b border-rule lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-6 py-3 lg:block lg:px-3 lg:py-6">
          <Link href="/business" aria-label="Symbolon home" className="lg:block lg:px-3">
            <Wordmark />
          </Link>
          <div className="lg:mt-7">
            <SpaceSwitcher spaces={where.spaces} current={current} who={where.who} />
          </div>
        </div>
        <BusinessNav inboxCount={navCounts?.inbox} approvalsCount={navCounts?.approvals} settingsDot={<ReleaseDotSlot biz={biz} />} />
      </aside>


      <div className="min-w-0">
        <header className="border-b border-rule">
         <div className={`${CONTAINER} flex items-center justify-between gap-x-3 py-3`}>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <StewardChipSlot biz={biz} />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/business/ask" className={buttonClass({ variant: "secondary", size: "sm", className: "hidden sm:inline-flex" })}>
              Ask the Steward
            </Link>
            <PauseSlot biz={biz} />
            <span className="hidden md:inline-block">{chain}</span>
            <Bell unreadCount={unreadCount ?? 0} />
          </div>
         </div>
        </header>

        {/* S13: pause banner while payments are paused; it eases open when the Vault read arrives */}
        <PausedSlots biz={biz} />

        {/* id="main-content" lets the skip-link jump here and lets Overlay make this inert while a dialog is open */}
        <main id="main-content" className={`${CONTAINER} py-10`}>{children}</main>
      </div>
    </div>
  );
}
