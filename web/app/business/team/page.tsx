import { notFound } from "next/navigation";

import { TeamView } from "@/components/team/TeamView";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { listTeamMembers } from "@/lib/server/team";
import { listTeamInvitations } from "@/lib/server/team-invitations";

export const dynamic = "force-dynamic";

export default async function BusinessTeamPage() {
  const session = await requirePageSession("/business/team");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  const config = getConfig();
  const db = await getDb();

  const [teamData, invitations] = await Promise.all([
    listTeamMembers(
      db,
      getClient(),
      config.deployment,
      session.user,
      where.business.id,
    ),
    listTeamInvitations(db, session.user, where.business.id),
  ]);

  const signer = await signerPlanFor(session, config);

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <TeamView
        {...teamData}
        invitations={invitations}
        signer={signer}
      />
    </Shell>
  );
}
