import Link from "next/link";
import { Suspense } from "react";
import { Shell } from "@/components/shell/Shell";
import { TreasuryView } from "@/components/treasury/TreasuryView";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { loadTreasury } from "@/lib/server/treasury";
import { PageLoading } from "@/components/ui/PageLoading";
import { PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export default async function BusinessTreasuryPage() {
  const session = await requirePageSession("/business/treasury");
  const where = await loadSpaces(session);
  const business = where.business;

  if (!business) {
    return (
      <Shell where={where} current={{ kind: "business", id: "" }}>
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
      </Shell>
    );
  }

  if (!business.vault) {
    return (
      <Shell where={where} current={{ kind: "business", id: business.id }}>
        <div>
          <PageTitle>Vault not created yet</PageTitle>
          <p className="mt-2 text-graphite">
            This business does not have an active Vault yet.{" "}
            {business.role === "owner" ? (
              <Link href={`/setup?business=${business.id}`} className="text-ink underline decoration-rule underline-offset-4">
                Finish setting up
              </Link>
            ) : (
              "Its owner hasn't finished setting up."
            )}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell where={where} current={{ kind: "business", id: business.id }}>
      <Suspense fallback={<PageLoading title="Treasury" shape="summary" />}>
        <TreasuryContent session={session} businessId={business.id} isOwner={business.role === "owner"} />
      </Suspense>
    </Shell>
  );
}

/** The part of the page that reads Arc; the frame and title are already on screen while this finishes (plan 05zd F6) */
async function TreasuryContent({ session, businessId, isOwner }: { session: Awaited<ReturnType<typeof requirePageSession>>; businessId: string; isOwner: boolean }) {
  const db = await getDb();
  const config = getConfig();
  const client = getClient();

  const state = await loadTreasury(db, client, config.deployment, businessId, session.user);
  const signer = signerPlanFor(session, config);

  return (
    <TreasuryView
      businessId={businessId}
      initialState={state}
      signer={signer}
      explorer={config.deployment.explorer}
      isOwner={isOwner}
    />
  );
}
