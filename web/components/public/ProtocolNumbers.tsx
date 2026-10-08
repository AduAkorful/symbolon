import type { ProtocolStats } from "@/lib/server/stats";
import { formatDay } from "@/lib/format";

const WHOLE = new Intl.NumberFormat("en-US");

/** "1,250.5": exact digits from the chain, grouped; never rounded */
function groupedAmount(amount: string): string {
  const [whole, fraction] = amount.split(".");
  return `${WHOLE.format(BigInt(whole!))}${fraction ? `.${fraction}` : ""}`;
}

/** The numbers, each with what it counts; used by the /stats page. Renders nothing it cannot prove. */
export function ProtocolNumbers({ stats }: { stats: ProtocolStats }) {
  const n = stats.numbers;
  if (!n) return null;
  const rows: [string, string, string][] = [
    ["Invoices settled", WHOLE.format(n.invoicesSettled), "Payments the ledger has recorded, each one an invoice paid in full or in part."],
    ...n.volume.map((v): [string, string, string] => [`${v.token} paid`, groupedAmount(v.amount), `Across ${WHOLE.format(v.settled)} ${v.settled === 1 ? "settlement" : "settlements"}. Each token is counted alone.`]),
    ["Vaults created", WHOLE.format(n.vaultsCreated), "By every Vault factory Symbolon has published."],
    ["Vendors paid", WHOLE.format(n.sealsPaid), "Distinct Seals that have been paid at least once."],
    ["Paying Vaults", WHOLE.format(n.payingVaults), "Distinct Vaults that have paid an invoice."],
    ["First settlement", n.firstSettlement ? formatDay(n.firstSettlement, { year: "always" }) : "Not known", "The earliest payment on the ledger."],
  ];
  return (
    <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([label, value, note]) => (
        <div key={label} className="border-t border-rule pt-4">
          <dt className="text-sm text-graphite">{label}</dt>
          <dd className="mt-1 font-display text-4xl leading-none text-ink">{value}</dd>
          <p className="mt-2 text-sm text-graphite">{note}</p>
        </div>
      ))}
    </dl>
  );
}
