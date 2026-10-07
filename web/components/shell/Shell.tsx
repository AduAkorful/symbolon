import Link from "next/link";
import type { ReactNode } from "react";
import { and, desc, eq } from "drizzle-orm";
import { getAddress } from "viem";

import { arcChain } from "@symbolon/chain";
import { chainEvents } from "@symbolon/db";

import { Wordmark } from "@/components/Marks";
import { PrivyBoundary } from "@/components/providers/PrivyBoundary";
import { PauseControl } from "@/components/steward/PauseControl";
import { TxLink } from "@/components/TxLink";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { getSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import type { Where } from "@/lib/server/space";
import { pauseStateOf, readVaultState, stewardStanding, type PauseState } from "@/lib/server/vault-read";
import { checkReleaseNudge } from "@/lib/server/release";
import { loadNavCounts, type NavCounts } from "@/lib/server/nav-counts";

import { BusinessNav } from "./BusinessNav";

import { Avatar } from "@/components/Avatar";
import { Bell } from "@/components/notifications/Bell";
import { getUnreadNotificationCount } from "@/lib/server/notifications";
import { SpaceSwitcher, type Current } from "./SpaceSwitcher";
import { VendorNav } from "./VendorNav";

const pill = "rounded-full border border-rule px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite";

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
        <header className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule px-6 py-3 md:px-10 lg:flex-nowrap">
          <Link href="/vendor" aria-label="Symbolon home" className="shrink-0">
            <Wordmark />
          </Link>
          {where.spaces.seal ? <VendorNav /> : null}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden xl:inline-block">{chain}</span>
            {where.spaces.seal ? (
              <Link href="/vendor/new" className="hidden whitespace-nowrap rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper sm:inline-block">
                New invoice
              </Link>
            ) : null}
            <Bell unreadCount={unreadCount ?? 0} />
            <SpaceSwitcher spaces={where.spaces} current={current} who={where.who} compact />
          </div>
        </header>
        {/* id="main-content" lets the skip-link jump here and lets Overlay make this inert while a dialog is open */}
        <main id="main-content" className="mx-auto max-w-[1180px] px-6 py-10 md:px-10">{children}</main>
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

  let standing = null;
  let pauseState: PauseState = { known: false };
  let vaultPaused = false;
  let pauseTxHash: string | null = null;
  let signer = null;
  let hasReleaseNudge = false;
  const explorer = arcChain(config.chainId).blockExplorers?.default.url ?? "";

  if (biz?.vault) {
    try {
      const client = getClient();
      const [vaultState, nudgeRes] = await Promise.all([
        readVaultState(client, config.deployment, biz.vault),
        checkReleaseNudge(client, config.deployment, getAddress(biz.vault)).catch(() => ({ hasNudge: false })),
      ]);
      standing = stewardStanding(biz.stewardWallet, vaultState);
      pauseState = pauseStateOf(vaultState);
      vaultPaused = vaultState.ok && vaultState.paused;
      hasReleaseNudge = nudgeRes.hasNudge;

      if (vaultPaused) {
        try {
          const db = await getDb();
          const [pe] = await db
            .select({ txHash: chainEvents.txHash })
            .from(chainEvents)
            .where(and(eq(chainEvents.address, getAddress(biz.vault).toLowerCase()), eq(chainEvents.eventName, "Paused")))
            .orderBy(desc(chainEvents.blockNumber))
            .limit(1);
          if (pe) pauseTxHash = pe.txHash;
        } catch (e) {
          console.error("reading the pause transaction failed", e);
        }
      }

      if (biz.role === "owner") {
        const session = await getSession();
        if (session) signer = signerPlanFor(session, config);
      }
    } catch (e) {
      console.error("reading Vault state for the shell failed", e);
    }
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      {/* S13: Red rule across top when payments are paused */}
      {vaultPaused ? <div className="col-span-full h-1 w-full bg-red" role="presentation" /> : null}

      <aside className="border-b border-rule md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-6 py-3 md:block md:px-3 md:py-6">
          <Link href="/business" aria-label="Symbolon home" className="md:block md:px-3">
            <Wordmark />
          </Link>
          <div className="md:mt-7">
            <SpaceSwitcher spaces={where.spaces} current={current} who={where.who} />
          </div>
        </div>
        <BusinessNav inboxCount={navCounts?.inbox} approvalsCount={navCounts?.approvals} hasReleaseNudge={hasReleaseNudge} />
      </aside>


      <div className="min-w-0">
        <header className="flex items-center justify-between gap-x-3 border-b border-rule px-6 py-3 md:px-10">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <StewardChip standing={standing} mode={biz?.stewardMode} />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/business/ask"
              className="hidden whitespace-nowrap rounded-doc border border-rule px-3 py-1.5 text-xs font-medium text-graphite transition hover:border-ink/50 hover:text-ink sm:inline-block"
            >
              Ask the Steward
            </Link>
            {biz && biz.role === "owner" && biz.vault ? (
              <PauseControl
                businessId={biz.id}
                paused={pauseState.known && pauseState.paused}
                block={pauseState.known ? pauseState.block.toString() : "0"}
                known={pauseState.known}
                signer={signer}
                compact
              />
            ) : null}
            <span className="hidden md:inline-block">{chain}</span>
            <Bell unreadCount={unreadCount ?? 0} />
          </div>
        </header>

        {/* S13: Pause banner when payments are paused */}
        {vaultPaused ? (
          <div className="border-b border-red/40 bg-red-wash px-6 py-3 text-sm text-ink md:px-10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                <span className="font-medium text-red">Payments are paused.</span> The Steward can't pay, and nothing scheduled goes out until you resume.
                {pauseTxHash ? (
                  <span className="ml-2">
                    <TxLink href={`${explorer}/tx/${pauseTxHash}`} label="View the pause transaction on the Arc explorer">
                      Transaction {pauseTxHash.slice(0, 10)}…{pauseTxHash.slice(-6)}
                    </TxLink>
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        ) : null}

        {/* id="main-content" lets the skip-link jump here and lets Overlay make this inert while a dialog is open */}
        <main id="main-content" className="px-6 py-10 md:px-10">{children}</main>
      </div>
    </div>
  );
}

const MODE_NAMES: Record<string, string> = { shadow: "Shadow", assist: "Assisted", auto: "Auto" };

/** What the header says about the Steward: its mode, and whether the Vault shows it paused, active, or something to look at */
function StewardChip({ standing, mode }: { standing: ReturnType<typeof stewardStanding> | null; mode: string | null | undefined }) {
  const modeName = mode ? MODE_NAMES[mode] : undefined;
  if (standing?.kind === "paused") {
    return (
      <span className="flex items-center gap-1.5 font-medium text-red">
        <span className="h-2 w-2 rounded-full bg-red" aria-hidden />
        Steward: Paused
      </span>
    );
  }
  if (standing?.kind === "mismatch") {
    return (
      <span className="flex items-center gap-1.5 text-amber-500">
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
        Steward mismatch
        <Link href="/business/steward" className="hidden text-xs underline underline-offset-4 sm:inline">Review</Link>
      </span>
    );
  }
  if (standing?.kind === "unknown") {
    return (
      <span className="flex items-center gap-1.5 text-graphite">
        <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
        Steward: can't confirm
      </span>
    );
  }
  if (standing?.kind === "active") {
    return (
      <span className="flex items-center gap-1.5 text-graphite">
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        Steward: <span className="text-ink">{modeName ?? "Active"}</span>
      </span>
    );
  }
  return <span className="text-graphite">Steward: Not ready</span>;
}
