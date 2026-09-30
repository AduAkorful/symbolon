import { notFound } from "next/navigation";
import { arcChain } from "@symbolon/chain";
import { ActivityView } from "@/components/activity/ActivityView";
import { Shell } from "@/components/shell/Shell";
import { loadActivity } from "@/lib/server/activity";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

export default async function BusinessActivityPage() {
  const session = await requirePageSession("/business/activity");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  const config = getConfig();
  const db = await getDb();
  const client = getClient();
  const explorer = arcChain(config.chainId).blockExplorers!.default.url;

  const feed = await loadActivity(db, client, session.user, where.business.id);

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <ActivityView initialFeed={feed} businessId={where.business.id} explorer={explorer} />
    </Shell>
  );
}
