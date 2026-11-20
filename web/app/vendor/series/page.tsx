import { Shell } from "@/components/shell/Shell";
import { SeriesClient } from "@/components/vendor/SeriesClient";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { nextInvoiceNumber } from "@/lib/server/invoice-send";
import { listSeries, releaseDueSafe } from "@/lib/server/series";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { listClients } from "@/lib/server/vendor";
import { requireVendorPage } from "@/lib/server/vendor-page";

export const dynamic = "force-dynamic";

export default async function VendorSeriesPage() {
  const { session, seal, where } = await requireVendorPage("/vendor/series");
  const db = await getDb();
  const config = getConfig();
  await releaseDueSafe(db, config, { seal: seal.address });

  const [series, clientRows, nextNumber] = await Promise.all([
    listSeries(db, session.user, config.deployment.cctpDomain),
    listClients(db, session.user),
    nextInvoiceNumber(db, seal.address),
  ]);
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
        nextNumber={nextNumber}
        clients={clients}
        signer={signer}
      />
    </Shell>
  );
}
