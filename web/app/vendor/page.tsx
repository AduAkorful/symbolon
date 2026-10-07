import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { listClients, mySeal } from "@/lib/server/vendor";
import { listMyInvoices } from "@/lib/server/invoice-send";
import { loadSpaces } from "@/lib/server/space";
import { showAmount, showDate } from "@/lib/format";
import { toneClass, vendorStatus } from "@/lib/invoice-status";
import { Address } from "@/components/Address";

export const dynamic = "force-dynamic";

/** A vendor's home: their Seal and their latest invoices. Without a Seal, the way to register one. */
export default async function VendorHome() {
  const session = await requirePageSession("/vendor");
  const db = await getDb();
  const seal = await mySeal(db, session.user.id);
  if (!seal) redirect("/vendor/start");
  const where = await loadSpaces(session);
  const [invoices, clients] = await Promise.all([listMyInvoices(db, session.user), listClients(db, session.user)]);

  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div className="max-w-[760px]">
        <h1 className="font-display text-4xl leading-tight">{seal.displayName}</h1>
        <p className="mt-2 text-graphite">
          <span className="font-mono">@{seal.handle}</span> · your Seal is <Address value={seal.address} full className="text-xs" />
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/vendor/new" className="rounded-doc bg-ink px-5 py-3 font-medium text-paper">
            New invoice
          </Link>
          <span className="text-sm text-graphite">
            {invoices.length} {invoices.length === 1 ? "invoice" : "invoices"} · {clients.length} {clients.length === 1 ? "client" : "clients"}
          </span>
        </div>

        <h2 className="mt-12 font-display text-2xl">Latest invoices</h2>
        {invoices.length === 0 ? (
          <p className="mt-3 text-graphite">You haven’t sent an invoice yet. Write one and sign it with your wallet; you get a link to send.</p>
        ) : (
          <ul className="mt-3 border-t border-rule text-sm">
            {invoices.slice(0, 5).map((i) => {
              const st = vendorStatus(i.status);
              return (
                <li key={i.fingerprint} className="border-b border-rule-soft">
                  <Link href={`/vendor/invoices/${i.fingerprint}`} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 py-3 hover:bg-rule-soft/40 sm:grid-cols-[6rem_1fr_auto_auto]">
                    <span className="font-mono">No. {i.invoiceNumber}</span>
                    <span className="min-w-0 truncate">{i.clientName}</span>
                    <span className="tabular-nums sm:text-right">
                      {showAmount(i.total)} {i.symbol}
                    </span>
                    <span className={`whitespace-nowrap text-xs sm:text-right ${toneClass[st.tone]}`}>
                      {st.label} · due {showDate(Math.floor(i.dueDate.getTime() / 1000))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Shell>
  );
}
