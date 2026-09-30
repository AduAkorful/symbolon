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
import { readVaultState, stewardStanding } from "@/lib/server/vault-read";

import { BusinessNav } from "./BusinessNav";
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
  inboxCount?: number;
  approvalsCount?: number;
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
  inboxCount,
  approvalsCount,
}: {
  where: Where;
  current: Current;
  children: ReactNode;
  inboxCount?: number;
  approvalsCount?: number;
}) {
  const config = getConfig();
  const testnet = config.testnet;
  const chain = <span className={pill}>{testnet ? "Arc testnet" : "Arc mainnet"}</span>;

  if (current.kind === "vendor") {
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
        {/* id="app-main" lets Overlay make this inert while a dialog is open */}
        <main id="app-main" className="mx-auto max-w-[1180px] px-6 py-10 md:px-10">{children}</main>
      </div>
    );
  }

  // Business shell: S13 status, pause banner, and controls
  const biz = current.id
    ? (where.business?.id === current.id ? where.business : where.spaces.businesses.find((b) => b.id === current.id))
    : where.business;

  let standing = null;
  let vaultPaused = false;
  let pauseTxHash: string | null = null;
  let signer = null;
  const explorer = arcChain(config.chainId).blockExplorers?.default.url ?? "";

  if (biz?.vault) {
    try {
      const client = getClient();
      const vaultState = await readVaultState(client, config.deployment, biz.vault);
      standing = stewardStanding(biz.stewardWallet, vaultState);
      vaultPaused = vaultState.ok && vaultState.paused;

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
        } catch {
          // ignore DB error reading pause tx
        }
      }

      if (biz.role === "owner") {
        const session = await getSession();
        if (session) signer = signerPlanFor(session, config);
      }
    } catch {
      // ignore onchain read error
    }
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      {/* S13: Red rule across top when payments are paused */}
      {vaultPaused ? <div className="col-span-full h-1 w-full bg-red" role="presentation" /> : null}

      <aside className="border-b border-rule md:sticky md:top-0 md:h-screen md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-6 py-5 md:block md:px-3 md:py-6">
          <Link href="/business" aria-label="Symbolon home" className="md:block md:px-3">
            <Wordmark />
          </Link>
          <div className="md:mt-7">
            <SpaceSwitcher spaces={where.spaces} current={current} who={where.who} />
          </div>
        </div>
        <BusinessNav inboxCount={inboxCount} approvalsCount={approvalsCount} />
      </aside>

      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-6 py-4 md:px-10">
          <div className="flex items-center gap-2 text-xs">
            {standing?.kind === "paused" ? (
              <span className="flex items-center gap-1.5 font-medium text-red">
                <span className="h-2 w-2 rounded-full bg-red" />
                Steward: Paused
              </span>
            ) : standing?.kind === "active" ? (
              <span className="flex items-center gap-1.5 text-graphite">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Steward: Active · <span className="capitalize text-ink">{biz?.stewardMode}</span>
              </span>
            ) : standing?.kind === "unknown" ? (
              <span className="flex items-center gap-1.5 text-graphite">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Can't confirm the Steward's state
              </span>
            ) : standing?.kind === "mismatch" ? (
              <span className="flex items-center gap-1.5 text-amber-500">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Steward mismatch
              </span>
            ) : (
              <span className="text-graphite">Steward: Not ready</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {biz && biz.role === "owner" && standing && (standing.kind === "paused" || standing.kind === "active") ? (
              <PauseControl
                businessId={biz.id}
                paused={standing.kind === "paused"}
                block={standing.block.toString()}
                signer={signer}
                compact
              />
            ) : null}
            {chain}
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

        {/* id="app-main" lets Overlay make this inert while a dialog is open */}
        <main id="app-main" className="px-6 py-10 md:px-10">{children}</main>
      </div>
    </div>
  );
}
