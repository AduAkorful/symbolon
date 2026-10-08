import { ClientForm } from "@/components/vendor/ClientForm";
import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { listClients } from "@/lib/server/vendor";
import { requireVendorPage } from "@/lib/server/vendor-page";
import { EmptyState } from "@/components/ui/States";
import { Lead, PageTitle } from "@/components/ui/Type";
import { Address } from "@/components/Address";
import { shortenAddressesIn } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function VendorClients() {
  const { session, where } = await requireVendorPage("/vendor/clients");
  const clients = await listClients(await getDb(), session.user);
  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div>
        <PageTitle>Clients</PageTitle>
        <Lead className="mt-3">The businesses you invoice. A client is remembered once you send them an invoice.</Lead>
        {clients.length === 0 ? (
          <EmptyState title="No clients yet" className="mt-8">Add one below, or send an invoice and they are added for you.</EmptyState>
        ) : (
          <ul className="mt-8 divide-y divide-rule-soft border-y border-rule">
            {clients.map((c) => (
              <li key={c.id} className="py-4">
                <p className="font-medium text-ink">{shortenAddressesIn(c.name)}</p>
                {c.vault ? <div className="mt-0.5 text-sm text-graphite"><Address value={c.vault} full copy /></div> : null}
                {c.email ? <p className="mt-0.5 break-words text-sm text-graphite">{c.email}</p> : null}
              </li>
            ))}
          </ul>
        )}
        <ClientForm />
      </div>
    </Shell>
  );
}
