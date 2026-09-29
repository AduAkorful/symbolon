import { Shell } from "@/components/shell/Shell";
import { Upload } from "@/components/vendor/Upload";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { nextInvoiceNumber } from "@/lib/server/invoice-send";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { listClients } from "@/lib/server/vendor";
import { requireVendorPage } from "@/lib/server/vendor-page";

export const dynamic = "force-dynamic";

export default async function UploadInvoice() {
  const { session, seal, where } = await requireVendorPage("/vendor/upload");
  const db = await getDb();
  const config = getConfig();
  const clients = (await listClients(db, session.user)).map((c) => ({ id: c.id, name: c.name, vault: c.vault, email: c.email }));
  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <Upload available={Boolean(config.anthropicApiKey)} handle={seal.handle} clients={clients} nextNumber={await nextInvoiceNumber(db, seal.address)} signer={signerPlanFor(session, config)} />
    </Shell>
  );
}
