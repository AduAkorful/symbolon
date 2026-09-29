import { Composer } from "@/components/vendor/Composer";
import { Shell } from "@/components/shell/Shell";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { nextInvoiceNumber } from "@/lib/server/invoice-send";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { listClients } from "@/lib/server/vendor";
import { requireVendorPage } from "@/lib/server/vendor-page";

export const dynamic = "force-dynamic";

export default async function NewInvoice() {
  const { session, seal, where } = await requireVendorPage("/vendor/new");
  const db = await getDb();
  const clients = (await listClients(db, session.user)).map((c) => ({ id: c.id, name: c.name, vault: c.vault, email: c.email }));
  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <Composer handle={seal.handle} clients={clients} nextNumber={await nextInvoiceNumber(db, seal.address)} signer={signerPlanFor(session, getConfig())} />
    </Shell>
  );
}
