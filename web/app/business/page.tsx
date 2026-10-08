import Link from "next/link";
import { arcChain } from "@symbolon/chain";
import { formatUnits } from "viem";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { pauseStateOf, readVaultState, readVaultSummary, stewardStanding } from "@/lib/server/vault-read";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { Address } from "@/components/Address";
import { PauseControl } from "@/components/steward/PauseControl";
import { StewardSwitch } from "@/components/steward/StewardSwitch";
import { loadAhead, loadNeedsYou, loadToday } from "@/lib/server/home";
import { HomeQueues } from "@/components/home/HomeQueues";
import { showMoney } from "@/lib/format";
import { LinkButton } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { Eyebrow, PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

/** A business's home: its Vault, status, Needs you queue, and today's activity. */
export default async function BusinessHome() {
  const session = await requirePageSession("/business");
  const where = await loadSpaces(session);
  const config = getConfig();
  const b = where.business;
  const explorer = arcChain(config.chainId).blockExplorers!.default.url;
  const summary = b?.vault ? await readVaultSummary(getClient(), config.deployment, b.vault) : null;
  // The Steward's standing is what the Vault says, compared with the wallet we set up (plan 05h, H13–H15)
  const vaultState = b?.vault ? await readVaultState(getClient(), config.deployment, b.vault) : null;
  const standing = b?.vault && vaultState ? stewardStanding(b.stewardWallet, vaultState) : null;
  const pause = vaultState ? pauseStateOf(vaultState) : null;
  const ownerSigner = b?.role === "owner" ? signerPlanFor(session, config) : null;

  const db = await getDb();
  const needsYou = b ? await loadNeedsYou(db, getClient(), config, session.user, b.id) : null;
  const today = b ? await loadToday(db, getClient(), config, session.user, b.id) : null;
  const ahead = b ? await loadAhead(db, getClient(), config, session.user, b.id) : null;

  return (
    <Shell where={where} current={{ kind: "business", id: b?.id ?? "" }}>
      {b ? (
        <div>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <Eyebrow className="capitalize">{b.role}</Eyebrow>
              <PageTitle className="mt-1">{b.name}</PageTitle>
            </div>
            <LinkButton href="/business/vendors" variant="secondary">Manage vendors</LinkButton>
          </div>

          <dl className="mt-8 divide-y divide-rule-soft rounded-doc border border-rule px-5 text-sm">
            <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-graphite">Vault</dt>
              <dd className="min-w-0">
                {b.vault ? (
                  <Address value={b.vault} full explorer={explorer} copy />
                ) : b.role === "owner" ? (
                  <span>
                    Not created yet.{" "}
                    <Link href={`/setup?business=${b.id}`} className="underline decoration-rule underline-offset-4">
                      Finish setting up
                    </Link>
                  </span>
                ) : (
                  "Not created yet. Its owner hasn’t finished setting up."
                )}
              </dd>
            </div>
            {b.vault && standing ? (
              <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-graphite">Steward</dt>
                <dd className="min-w-0">
                  {standing.kind === "none" ? (
                    "No Steward assigned. This Vault was made before Stewards were set up at creation."
                  ) : standing.kind === "unknown" || standing.kind === "mismatch" ? (
                    <>
                      <span className="text-red">
                        {standing.kind === "unknown"
                          ? "Can’t confirm the Steward’s state right now."
                          : "The Steward this Vault reports isn’t the wallet we set up for this business. Don’t rely on it."}
                      </span>
                      {/* The owner can always pause, whatever the Steward's standing */}
                      {pause && b.role === "owner" ? (
                        <PauseControl
                          businessId={b.id}
                          paused={pause.known && pause.paused}
                          block={pause.known ? pause.block.toString() : "0"}
                          known={pause.known}
                          signer={ownerSigner}
                          explorer={explorer}
                        />
                      ) : null}
                    </>
                  ) : (
                    <>
                      <StewardSwitch
                        businessId={b.id}
                        state={standing.kind}
                        block={standing.block.toString()}
                        steward={standing.steward}
                        signer={b.role === "owner" ? signerPlanFor(session, config) : null}
                        explorer={explorer}
                      />
                      <p className="mt-3">
                        <Link href="/business/steward" className="underline decoration-rule underline-offset-4 hover:text-ink">
                          Steward settings and activity →
                        </Link>
                      </p>
                    </>
                  )}
                </dd>
              </div>
            ) : null}
            {b.vault ? (
              <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-graphite">USDC held</dt>
                <dd>
                  {summary?.ok ? (
                    <>
                      <Money className="font-medium">{showMoney(formatUnits(summary.usdc, summary.decimals), "USDC")}</Money>
                      <span className="ml-2 text-graphite">read from Arc at block {summary.block.toString()}</span>
                    </>
                  ) : (
                    <span className="text-red">Can’t confirm the balance right now.</span>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>

          {needsYou && today ? (
            <HomeQueues needsYou={needsYou} today={today} ahead={ahead ?? undefined} />
          ) : null}
        </div>
      ) : (
        <div>
          <PageTitle>No business yet</PageTitle>
          <p className="mt-2 text-graphite">
            You don’t belong to a business.{" "}
            <Link href="/setup" className="text-ink underline decoration-rule underline-offset-4">
              Set up a business
            </Link>
            .
          </p>
        </div>
      )}
    </Shell>
  );
}
