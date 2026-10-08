import { Suspense } from "react";

import { PauseControl } from "@/components/steward/PauseControl";
import { TxLink } from "@/components/TxLink";
import { getConfig } from "@/lib/server/config";
import { getSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadShellVault } from "@/lib/server/shell-vault";
import { arcChain } from "@symbolon/chain";

import { CONTAINER } from "./container";
import { StewardChip } from "./StewardChip";

// Plan 05zd F2. The parts of the frame that wait on Arc. Each sits in its own Suspense boundary with a placeholder the size of
// the real thing, so the page is drawn at once and nothing moves when the answer arrives.

interface Biz {
  id: string;
  vault: string | null;
  stewardWallet: string | null;
  stewardMode?: string | null;
  role: string;
}

/** The chip's real width varies with its words; the placeholder holds the line and the left edge */
const chipBox = "inline-flex h-5 items-center";

export function StewardChipSlot({ biz }: { biz: Biz | null | undefined }) {
  if (!biz?.vault) return <StewardChip standing={null} mode={biz?.stewardMode} />;
  return (
    <Suspense
      fallback={
        <span className={`${chipBox} gap-1.5 whitespace-nowrap text-graphite`} aria-busy="true">
          <span className="h-2 w-2 rounded-full bg-rule" aria-hidden />
          Steward: checking…
        </span>
      }
    >
      <ChipResolved vault={biz.vault} stewardWallet={biz.stewardWallet} mode={biz.stewardMode} />
    </Suspense>
  );
}

async function ChipResolved({ vault, stewardWallet, mode }: { vault: string; stewardWallet: string | null; mode: string | null | undefined }) {
  const v = await loadShellVault(vault, stewardWallet);
  return <StewardChip standing={v.standing} mode={mode} />;
}

/** The owner's pause control. Same fixed width before and after, so the buttons beside it never shift. */
const pauseBox = "flex w-20 shrink-0 justify-end sm:w-[9.25rem]";

export function PauseSlot({ biz }: { biz: Biz | null | undefined }) {
  if (!biz || biz.role !== "owner" || !biz.vault) return null;
  return (
    <div className={pauseBox}>
      <Suspense fallback={<span className="block min-h-11 w-full rounded-doc bg-rule-soft motion-safe:animate-pulse sm:min-h-9 sm:w-[8.4rem]" aria-hidden />}>
        <PauseResolved businessId={biz.id} vault={biz.vault} stewardWallet={biz.stewardWallet} />
      </Suspense>
    </div>
  );
}

async function PauseResolved({ businessId, vault, stewardWallet }: { businessId: string; vault: string; stewardWallet: string | null }) {
  const [v, session] = await Promise.all([loadShellVault(vault, stewardWallet), getSession()]);
  const signer = session ? signerPlanFor(session, getConfig()) : null;
  const { pauseState } = v;
  return (
    <PauseControl
      businessId={businessId}
      paused={pauseState.known && pauseState.paused}
      block={pauseState.known ? pauseState.block.toString() : "0"}
      known={pauseState.known}
      signer={signer}
      compact
    />
  );
}

/** A red rule across the very top and the banner under the header while payments are paused. The rule is laid over the page, so it moves nothing; the banner eases open. */
export function PausedSlots({ biz }: { biz: Biz | null | undefined }) {
  if (!biz?.vault) return null;
  return (
    <Suspense fallback={null}>
      <PausedResolved vault={biz.vault} stewardWallet={biz.stewardWallet} />
    </Suspense>
  );
}

async function PausedResolved({ vault, stewardWallet }: { vault: string; stewardWallet: string | null }) {
  const v = await loadShellVault(vault, stewardWallet);
  if (!v.paused) return null;
  const explorer = arcChain(getConfig().chainId).blockExplorers?.default.url ?? "";
  return (
    <div className="banner-in border-b border-red/40 bg-red-wash text-sm text-ink">
      <div className={`${CONTAINER} flex flex-wrap items-center justify-between gap-2 py-3`}>
        <p>
          <span className="font-medium text-red">Payments are paused.</span> The Steward can't pay, and nothing scheduled goes out until you resume.
          {v.pauseTxHash ? (
            <span className="ml-2">
              <TxLink href={`${explorer}/tx/${v.pauseTxHash}`} label="View the pause transaction on the Arc explorer">
                Transaction {v.pauseTxHash.slice(0, 10)}…{v.pauseTxHash.slice(-6)}
              </TxLink>
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/** The red rule across the top of the window; fixed, so it adds no height */
export function PausedRule({ biz }: { biz: Biz | null | undefined }) {
  if (!biz?.vault) return null;
  return (
    <Suspense fallback={null}>
      <RuleResolved vault={biz.vault} stewardWallet={biz.stewardWallet} />
    </Suspense>
  );
}

async function RuleResolved({ vault, stewardWallet }: { vault: string; stewardWallet: string | null }) {
  const v = await loadShellVault(vault, stewardWallet);
  return v.paused ? <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-1 bg-red" role="presentation" /> : null;
}

/** The dot on "Settings" when a newer Vault release exists. It sits after the label and takes no room until it arrives, so the label never moves. */
export function ReleaseDotSlot({ biz }: { biz: Biz | null | undefined }) {
  if (!biz?.vault) return null;
  return (
    <Suspense fallback={null}>
      <DotResolved vault={biz.vault} stewardWallet={biz.stewardWallet} />
    </Suspense>
  );
}

async function DotResolved({ vault, stewardWallet }: { vault: string; stewardWallet: string | null }) {
  const v = await loadShellVault(vault, stewardWallet);
  return v.hasReleaseNudge ? <span className="h-1.5 w-1.5 rounded-full bg-seal" aria-label="Release update available" /> : null;
}
