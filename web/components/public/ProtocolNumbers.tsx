import { Address } from "@/components/Address";
import { TxLink } from "@/components/TxLink";
import { Money } from "@/components/ui/Money";
import { formatDay } from "@/lib/format";
import type { ProtocolStats } from "@/lib/server/stats";

const WHOLE = new Intl.NumberFormat("en-US");

/** "1,250.5": exact digits from the chain, grouped; never rounded */
function groupedAmount(amount: string): string {
  const [whole, fraction] = amount.split(".");
  return `${WHOLE.format(BigInt(whole!))}${fraction ? `.${fraction}` : ""}`;
}

/** "1 vendor", "3 vendors" */
const count = (n: number, one: string, many: string) => `${WHOLE.format(n)} ${n === 1 ? one : many}`;

/**
 * The network numbers on the landing page (plan 05zg): two headline figures, the latest settlements each with a link to its
 * transaction, and one quiet line for the rest. Renders nothing it cannot prove; a small number stays small.
 */
export function ProtocolNumbers({ stats }: { stats: ProtocolStats }) {
  const n = stats.numbers;
  if (!n) return null;
  const quiet = [
    ...n.volume.map((v) => `${groupedAmount(v.amount)} ${v.token} paid`),
    ...(n.otherTokenSettlements > 0 ? [`${count(n.otherTokenSettlements, "settlement", "settlements")} in another token`] : []),
    count(n.sealsPaid, "vendor paid", "vendors paid"),
    `${n.payingVaults === 1 ? "1 Vault has" : `${WHOLE.format(n.payingVaults)} Vaults have`} paid`,
    ...(n.firstSettlement ? [`first settlement ${formatDay(n.firstSettlement, { year: "always" })}`] : []),
  ];
  // value locked: the first token is the headline, the others follow in the note, and tokens are never added together
  const [headline, ...rest] = n.locked?.tokens ?? [];
  return (
    <div className="mt-10">
      <dl className={`grid gap-x-12 gap-y-8 sm:grid-cols-2 ${n.locked ? "lg:grid-cols-3" : ""}`}>
        <div className="border-t border-rule pt-4">
          <dt className="text-sm text-graphite">Vaults created</dt>
          <dd className="mt-1 font-display text-6xl leading-none text-ink">{WHOLE.format(n.vaultsCreated)}</dd>
          <p className="mt-3 max-w-[40ch] text-sm text-graphite">By every Vault factory Symbolon has published.</p>
        </div>
        <div className="border-t border-rule pt-4">
          <dt className="text-sm text-graphite">Invoices settled</dt>
          <dd className="mt-1 font-display text-6xl leading-none text-ink">{WHOLE.format(n.invoicesSettled)}</dd>
          <p className="mt-3 max-w-[40ch] text-sm text-graphite">Payments the ledger has recorded, each an invoice paid in full or in part.</p>
        </div>
        {n.locked && headline ? (
          <div className="border-t border-rule pt-4">
            <dt className="text-sm text-graphite">Value locked in Vaults</dt>
            <dd className="mt-1 font-display text-6xl leading-none text-ink">
              {groupedAmount(headline.amount)}
              <span className="ml-2 font-sans text-base text-graphite">{headline.token}</span>
            </dd>
            <p className="mt-3 max-w-[40ch] text-sm text-graphite">
              {rest.length > 0 ? `${rest.map((t) => `${groupedAmount(t.amount)} ${t.token}`).join(" · ")}. ` : ""}Held by {count(n.locked.vaults, "Vault", "Vaults")} right now, read from Arc. Each token is counted alone.
            </p>
          </div>
        ) : null}
      </dl>

      {n.invoicesSettled === 0 ? (
        <p className="mt-8 text-sm text-graphite">No invoice has been settled yet.</p>
      ) : (
        <>
          <p className="mt-8 text-sm text-graphite">{quiet.join(" · ")}</p>
          <h3 className="mt-10 font-display text-xl">Latest settlements</h3>
          <ol className="mt-3 divide-y divide-rule-soft border-y border-rule">
            {n.latest.map((s) => (
              <li key={s.txHash} className="grid gap-x-6 gap-y-1 py-4 text-sm md:grid-cols-[6.5rem_9rem_minmax(0,1fr)_auto] md:items-center">
                <span className="text-graphite">{s.at ? formatDay(s.at, { year: "always" }) : "Date unknown"}</span>
                <Money className="font-medium text-ink">{s.token && s.amount ? `${groupedAmount(s.amount)} ${s.token}` : "Another token"}</Money>
                <span className="min-w-0 space-y-1 text-graphite">
                  <span className="block min-w-0">Paid by Vault<Address value={s.payer} full explorer={stats.explorer} className="text-ink" /></span>
                  <span className="block min-w-0">to Seal<Address value={s.seal} full explorer={stats.explorer} className="text-ink" /></span>
                </span>
                <TxLink href={`${stats.explorer}/tx/${s.txHash}`} label="View this settlement on the Arc explorer">Transaction</TxLink>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
