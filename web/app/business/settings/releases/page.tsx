import Link from "next/link";
import { notFound } from "next/navigation";
import { getAddress } from "viem";

import { Address } from "@/components/Address";
import { ReleaseNotesBody } from "@/components/settings/ReleaseNotesBody";
import { Shell } from "@/components/shell/Shell";
import { Callout } from "@/components/ui/Callout";
import { EmptyState } from "@/components/ui/States";
import { StatusPill } from "@/components/ui/StatusPill";
import { Lead, PageTitle, SectionTitle } from "@/components/ui/Type";
import { formatDay } from "@/lib/format";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { requirePageSession } from "@/lib/server/http";
import { loadReleaseHistory } from "@/lib/server/release-history";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

export default async function ReleaseHistoryPage() {
  const session = await requirePageSession("/business/settings/releases");
  const where = await loadSpaces(session);
  const business = where.business;
  if (!business) notFound();
  const config = getConfig();

  let history: Awaited<ReturnType<typeof loadReleaseHistory>> | null = null;
  try {
    history = await loadReleaseHistory(getClient(), config.deployment, business.vault ? getAddress(business.vault) : null);
  } catch {
    history = null;
  }
  const explorer = config.deployment.explorer;

  return (
    <Shell where={where} current={{ kind: "business", id: business.id }}>
      <div className="max-w-3xl">
        <Link href="/business/settings" className="text-sm text-graphite underline decoration-rule underline-offset-4 hover:text-ink">
          Back to settings
        </Link>
        <PageTitle className="mt-4">Vault releases</PageTitle>
        <Lead className="mt-3">
          Every version of the Vault contract Symbolon has published, newest first. Your Vault only changes version when its owner
          schedules and applies an upgrade.
        </Lead>

        {history === null ? (
          <Callout tone="warn" className="mt-6">Can’t read the release registry on Arc right now, so no list is shown. Try again in a moment.</Callout>
        ) : history.length === 0 ? (
          <EmptyState title="No releases published" className="mt-6">The registry has no published release this app knows about.</EmptyState>
        ) : (
          <ol className="mt-8 space-y-10">
            {history.map((r) => (
              <li key={r.implementation} className="border-t border-rule pt-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <SectionTitle>Release {r.version}</SectionTitle>
                  {r.runsHere ? <StatusPill tone="ok">Your Vault runs this</StatusPill> : null}
                  {r.isLatest && !r.revoked ? <StatusPill tone="info">Latest</StatusPill> : null}
                  {r.revoked ? <StatusPill tone="danger">Revoked</StatusPill> : null}
                </div>
                <p className="mt-1 text-sm text-graphite">Published {formatDay(new Date(r.publishedAt * 1000))}</p>
                <div className="mt-2 text-sm text-graphite">
                  Contract <Address value={r.implementation} full explorer={explorer} copy />
                </div>

                {r.notes ? (
                  <div className="mt-4 space-y-3 text-sm text-ink">
                    <ReleaseNotesBody notes={r.notes} />
                    <p className="text-xs text-graphite">
                      Notes as published, checked against the registry’s record of them.
                      {r.notesTrimmed ? " References to internal planning documents are left out here." : ""}
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-graphite">
                    These notes can’t be verified against the registry’s record of them (hash <span className="font-mono">{r.notesHash.slice(0, 10)}…{r.notesHash.slice(-6)}</span>), so they aren’t shown.
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Shell>
  );
}
