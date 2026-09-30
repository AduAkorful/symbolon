import Link from "next/link";
import { arcChain } from "@symbolon/chain";
import { formatUnits } from "viem";
import { Shell } from "@/components/shell/Shell";
import { TxLink } from "@/components/TxLink";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { readVaultState, readVaultSummary, stewardStanding } from "@/lib/server/vault-read";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { StewardSwitch } from "@/components/steward/StewardSwitch";

export const dynamic = "force-dynamic";

/** A business's home. For now: its Vault, read live from Arc, and what is still to do. */
export default async function BusinessHome() {
  const session = await requirePageSession("/business");
  const where = await loadSpaces(session);
  const config = getConfig();
  const b = where.business;
  const explorer = arcChain(config.chainId).blockExplorers!.default.url;
  const summary = b?.vault ? await readVaultSummary(getClient(), config.deployment, b.vault) : null;
  // The Steward's standing is what the Vault says, compared with the wallet we set up (plan 05h, H13–H15)
  const standing = b?.vault ? stewardStanding(b.stewardWallet, await readVaultState(getClient(), config.deployment, b.vault)) : null;

  return (
    <Shell where={where} current={{ kind: "business", id: b?.id ?? "" }}>
      {b ? (
        <div className="max-w-[760px]">
          <h1 className="font-display text-4xl leading-tight">{b.name}</h1>
          <p className="mt-2 text-graphite">
            You’re signed in as <span className="capitalize text-ink">{b.role}</span>.
          </p>
          <p className="mt-5 text-sm"><Link href="/business/vendors" className="underline decoration-rule underline-offset-4">Manage vendors</Link></p>
          <dl className="mt-8 border-t border-rule text-sm">
            <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule-soft py-3">
              <dt className="text-graphite">Vault</dt>
              <dd>
                {b.vault ? (
                  <TxLink href={`${explorer}/address/${b.vault}`} label="View the Vault on the Arc explorer" className="break-all">
                    {b.vault}
                  </TxLink>
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
              <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule-soft py-3">
                <dt className="text-graphite">Steward</dt>
                <dd>
                  {standing.kind === "none" ? (
                    "No Steward assigned. This Vault was made before Stewards were set up at creation."
                  ) : standing.kind === "unknown" ? (
                    <span className="text-red">Can’t confirm the Steward’s state right now.</span>
                  ) : standing.kind === "mismatch" ? (
                    <span className="text-red">The Steward this Vault reports isn’t the wallet we set up for this business. Don’t rely on it.</span>
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
                      <div className="mt-2">
                        <Link href="/business/steward" className="text-xs text-graphite hover:text-ink underline decoration-rule underline-offset-4">
                          Steward settings & activity →
                        </Link>
                      </div>
                    </>
                  )}
                </dd>
              </div>
            ) : null}
            {b.vault ? (
              <div className="grid grid-cols-[10rem_1fr] gap-3 border-b border-rule-soft py-3">
                <dt className="text-graphite">USDC held</dt>
                <dd>
                  {summary?.ok ? (
                    <>
                      ${Number(formatUnits(summary.usdc, summary.decimals)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                      <span className="ml-2 text-xs text-graphite">read from Arc at block {summary.block.toString()}</span>
                    </>
                  ) : (
                    <span className="text-red">Can’t confirm the balance right now.</span>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : (
        <div className="max-w-[760px]">
          <h1 className="font-display text-4xl leading-tight">No business yet</h1>
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
