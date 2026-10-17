import { formatDay, showAmount } from "@/lib/format";
import type { ProtocolStats } from "@/lib/server/stats";

const WHOLE = new Intl.NumberFormat("en-US");

/** "503.956799" → "503.96": grouped, two decimals (FMT-1); the exact digits stay on the explorer */
const groupedAmount = (amount: string) => showAmount(amount);

/** "1 vendor", "3 vendors" */
const count = (n: number, one: string, many: string) => `${WHOLE.format(n)} ${n === 1 ? one : many}`;

/**
 * The network numbers on the landing page (plan 05zg): the headline figures and one quiet line for the rest. Renders nothing it cannot prove; a small number stays small.
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
  // value locked: one tile per token, all the same size (plan 05zj G, SYM-40: the first token used to dominate the others); tokens
  // are never added together
  const lockedTokens = n.locked?.tokens ?? [];
  const columns = 2 + lockedTokens.length;
  const LG_COLUMNS: Record<number, string> = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };
  return (
    <div className="mt-10">
      <dl className={`grid gap-x-8 gap-y-8 sm:grid-cols-2 ${LG_COLUMNS[Math.min(columns, 4)] ?? "lg:grid-cols-3"}`}>
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
        {n.locked
          ? lockedTokens.map((t) => (
              <div key={t.token} className="min-w-0 border-t border-rule pt-4">
                <dt className="text-sm text-graphite">{t.token} locked in Vaults</dt>
                <dd className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 font-display text-[clamp(2rem,4.2vw,3.75rem)] leading-none text-ink [overflow-wrap:anywhere]">
                  <span className="min-w-0">{groupedAmount(t.amount)}</span>
                  <span className="font-sans text-base text-graphite">{t.token}</span>
                </dd>
                <p className="mt-3 max-w-[40ch] text-sm text-graphite">
                  Held by {count(n.locked!.vaults, "Vault", "Vaults")} right now, read from Arc. Each token is counted alone.
                </p>
              </div>
            ))
          : null}
      </dl>

      {n.invoicesSettled === 0 ? (
        <p className="mt-8 text-sm text-graphite">No invoice has been settled yet.</p>
      ) : (
        <p className="mt-8 text-sm text-graphite">{quiet.join(" · ")}</p>
      )}
    </div>
  );
}
