import { money } from "@/lib/demo";

/** An amount at full token precision: cents in full ink, the remaining four decimals in pencil */
export function Money({
  raw,
  token,
  precise = true,
  tabular = false,
  symbol,
  className = "",
}: {
  raw: string;
  token?: string;
  /** Show the four sub-cent decimals (in pencil); off for buttons and headlines */
  precise?: boolean;
  /** Fixed-width digits, for amounts stacked in a column */
  tabular?: boolean;
  /** Currency symbol before the amount: $ for USDC (and USDC value), € for EURC */
  symbol?: "$" | "€";
  className?: string;
}) {
  const [whole, cents, rest] = money(raw);
  return (
    <span className={`${tabular ? "tabular-nums" : ""} ${className}`}>
      {symbol}
      {whole}
      {cents}
      {precise ? <span className="text-graphite/60 max-sm:hidden">{rest}</span> : null}
      {token ? <span className="ml-1.5 text-[0.62em] font-medium tracking-wide text-graphite">{token}</span> : null}
    </span>
  );
}
