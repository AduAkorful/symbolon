const DAY = 86_400n;

/** A known future cash movement for one Vault, in raw units of its accounting token */
export interface CashFlow {
  /** Unix seconds */
  at: bigint;
  amount: bigint;
  direction: "out" | "in";
  /** e.g. the invoice fingerprint */
  ref: string;
}

export interface ForecastDay {
  day: bigint;
  outflows: bigint;
  inflows: bigint;
  /** Cash at the end of the day */
  balance: bigint;
}

/** Day-by-day cash from `now` over `days`, starting from `cash` (overdue flows land on day 0) */
export function forecast(cash: bigint, flows: readonly CashFlow[], now: bigint, days: number): ForecastDay[] {
  const start = now / DAY;
  const out: ForecastDay[] = [];
  let balance = cash;
  for (let i = 0; i < days; i++) {
    const day = start + BigInt(i);
    let outflows = 0n;
    let inflows = 0n;
    for (const f of flows) {
      const d = f.at / DAY < start ? start : f.at / DAY;
      if (d !== day) continue;
      if (f.direction === "out") outflows += f.amount;
      else inflows += f.amount;
    }
    balance = balance + inflows - outflows;
    out.push({ day, outflows, inflows, balance });
  }
  return out;
}

/** Outflows due within `days` of `now` (including overdue) */
export function outflowsWithin(flows: readonly CashFlow[], now: bigint, days: number): bigint {
  const end = now + BigInt(days) * DAY;
  return flows.filter((f) => f.direction === "out" && f.at <= end).reduce((sum, f) => sum + f.amount, 0n);
}

/**
 * Days until cash runs out on the forecast, or undefined if it lasts the whole horizon. Counts full days with a
 * non-negative balance.
 */
export function runwayDays(cash: bigint, flows: readonly CashFlow[], now: bigint, horizonDays: number): number | undefined {
  const days = forecast(cash, flows, now, horizonDays);
  const firstNegative = days.findIndex((d) => d.balance < 0n);
  return firstNegative === -1 ? undefined : firstNegative;
}

/** Cash a Vault will be short of in one token, with the invoices that need it */
export interface TokenShortfall {
  token: string;
  balance: bigint;
  due: bigint;
  short: bigint;
  refs: string[];
}

/**
 * Tokens whose outflows due within `days` (including overdue) exceed the Vault's balance of that token. The Vault
 * never swaps, so a shortfall in a token (e.g. EURC) is for the owner to fund, not the Steward to cover from another.
 */
export function tokenShortfalls(
  balances: ReadonlyMap<string, bigint>,
  flows: readonly (CashFlow & { token: string })[],
  now: bigint,
  days: number,
): TokenShortfall[] {
  const end = now + BigInt(days) * DAY;
  const byToken = new Map<string, { due: bigint; refs: string[] }>();
  for (const f of flows) {
    if (f.direction !== "out" || f.at > end) continue;
    const token = f.token.toLowerCase();
    const entry = byToken.get(token) ?? { due: 0n, refs: [] };
    entry.due += f.amount;
    entry.refs.push(f.ref);
    byToken.set(token, entry);
  }
  const out: TokenShortfall[] = [];
  for (const [token, { due, refs }] of byToken) {
    let balance = 0n;
    for (const [t, b] of balances) if (t.toLowerCase() === token) balance = b;
    if (due > balance) out.push({ token, balance, due, short: due - balance, refs });
  }
  return out;
}
