import { notFound } from "next/navigation";

import { Shell } from "@/components/shell/Shell";
import { EarlyPayClient } from "@/components/vendor/EarlyPayClient";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { myInvoice } from "@/lib/server/invoice-send";
import { listOffersForInvoice, suggestedDiscount } from "@/lib/server/offers";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { requireVendorPage } from "@/lib/server/vendor-page";

export const dynamic = "force-dynamic";

export default async function VendorInvoiceEarlyPage({
  params,
}: {
  params: Promise<{ fingerprint: string }>;
}) {
  const { fingerprint } = await params;
  const { session, seal, where } = await requireVendorPage(`/vendor/invoices/${fingerprint}/early`);
  const db = await getDb();
  const config = getConfig();

  const found = await myInvoice(db, session.user, fingerprint);
  if (!found) notFound();

  const offers = await listOffersForInvoice(db, fingerprint);
  const suggested = await suggestedDiscount(db, seal.address);
  const signer = signerPlanFor(session, config);

  const due = new Date(found.sealed.document.dueDate * 1000);
  const now = new Date();
  const dueDays = Math.max(0, Math.ceil((due.getTime() - now.getTime()) / (1000 * 86400)));

  const invoiceSummary = {
    fingerprint: found.row.fingerprint,
    invoiceNumber: found.row.invoiceNumber,
    clientName: found.sealed.document.payer.name,
    total: found.row.total.toString(),
    credited: found.row.credited.toString(),
    currencySymbol: found.sealed.document.currency.symbol,
    decimals: found.sealed.document.currency.decimals,
    dueDate: due.toISOString().slice(0, 10),
    dueDays,
  };

  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <EarlyPayClient
        invoice={invoiceSummary}
        offers={offers}
        suggested={suggested}
        signer={signer}
      />
    </Shell>
  );
}
