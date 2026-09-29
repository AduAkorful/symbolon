import { ClientForm } from "@/components/vendor/ClientForm";
import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { listClients } from "@/lib/server/vendor";
import { requireVendorPage } from "@/lib/server/vendor-page";

export const dynamic = "force-dynamic";

export default async function VendorClients() {
  const { session, where } = await requireVendorPage("/vendor/clients");
  const clients = await listClients(await getDb(), session.user);
  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div className="max-w-[760px]">
        <h1 className="font-display text-4xl leading-tight">Clients</h1>
        <p className="mt-2 text-graphite">The businesses you invoice. A client is remembered when you send them an invoice.</p>
        {clients.length === 0 ? (
          <p className="mt-6 text-graphite">No clients yet.</p>
        ) : (
          <ul className="mt-6 border-t border-rule text-sm">
            {clients.map((c) => (
              <li key={c.id} className="border-b border-rule-soft py-3">
                <p className="font-medium">{c.name}</p>
                <p className="break-all font-mono text-xs text-graphite">{[c.vault, c.email].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
        )}
        <ClientForm />
      </div>
    </Shell>
  );
}
