import { Shell } from "@/components/shell/Shell";
import { SeriesClient } from "@/components/vendor/SeriesClient";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { listSeries, releaseDueSafe } from "@/lib/server/series";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { listClients, requireMySeal } from "@/lib/server/vendor";
import { requireVendorPage } from "@/lib/server/vendor-page";

export const dynamic = "force-dynamic";

export default async function VendorSeriesPage() {
  const { session, where } = await requireVendorPage("/vendor/series");
  const db = await getDb();
  const config = getConfig();
  const seal = await requireMySeal(db, session.user.id);
  await releaseDueSafe(db, config, { seal: seal.address });

  const series = await listSeries(db, session.user);
  const clientRows = await listClients(db, session.user);
  const signer = signerPlanFor(session, config);

  const clients = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    vault: c.vault,
    email: c.email,
  }));

  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <SeriesClient
        initialSeries={series}
        clients={clients}
        signer={signer}
      />
    </Shell>
  );
}
