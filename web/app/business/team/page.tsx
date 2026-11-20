import { notFound } from "next/navigation";
import { Suspense } from "react";

import { TeamView } from "@/components/team/TeamView";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession, type CurrentSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { listTeamMembers } from "@/lib/server/team";
import { listTeamInvitations } from "@/lib/server/team-invitations";
import { PageLoading } from "@/components/ui/PageLoading";

export const dynamic = "force-dynamic";

export default async function BusinessTeamPage() {
  const session = await requirePageSession("/business/team");
  const where = await loadSpaces(session);
  if (!where.business) notFound();
  const businessId = where.business.id;

  return (
    <Shell where={where} current={{ kind: "business", id: businessId }}>
      <Suspense fallback={<PageLoading title="Team" shape="list" />}>
        <TeamContent session={session} businessId={businessId} />
      </Suspense>
    </Shell>
  );
}

async function TeamContent({ session, businessId }: { session: CurrentSession; businessId: string }) {
  const config = getConfig();
  const db = await getDb();
  const [teamData, invitations] = await Promise.all([
    listTeamMembers(db, getClient(), config.deployment, session.user, businessId),
    listTeamInvitations(db, session.user, businessId),
  ]);
  const signer = signerPlanFor(session, config);

  return <TeamView {...teamData} invitations={invitations} signer={signer} />;
}
