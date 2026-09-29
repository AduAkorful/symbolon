/**
 * Operating balance over the next five weeks as one stepped line: bills are drops on their due dates, a reserve
 * redemption is a rise, and a dotted path shows where the balance would have gone without it. Thousands of USDC.
 */

export interface ForecastEvent {
  day: number; // days from today
  delta: number; // thousands; negative = bill paid, positive = money in
  label: string;
  kind: "bill" | "redeem";
}

const W = 1000;
const H = 300;
const PAD = { l: 8, r: 118, t: 26, b: 34 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

export function ForecastChart({
  start,
  days,
  buffer,
  events,
  dates,
  yMin = 12,
  yMax = 42,
}: {
  start: number;
  days: number;
  buffer: number;
  events: ForecastEvent[];
  /** Tick labels by day offset */
  dates: { day: number; label: string }[];
  yMin?: number;
  yMax?: number;
}) {
  const x = (d: number) => PAD.l + (d / days) * plotW;
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Stepped path: horizontal to each event's day, then vertical by its delta
  let bal = start;
  let d = `M ${x(0)} ${y(bal)}`;
  const points: { e: ForecastEvent; before: number; after: number }[] = [];
  for (const e of events) {
    d += ` H ${x(e.day)}`;
    const before = bal;
    bal += e.delta;
    d += ` V ${y(bal)}`;
    points.push({ e, before, after: bal });
  }
  d += ` H ${x(days)}`;
  const end = bal;

  // Where the balance would have gone without the redemption: only as far as the bill that would cross the buffer
  const redeem = points.find((p) => p.e.kind === "redeem");
  let ghost = "";
  let ghostEnd: { x: number; v: number } | null = null;
  if (redeem) {
    let g = redeem.before;
    ghost = `M ${x(redeem.e.day)} ${y(g)}`;
    for (const p of points.filter((q) => q.e.day > redeem.e.day)) {
      ghost += ` H ${x(p.e.day)}`;
      g += p.e.delta;
      ghost += ` V ${y(g)}`;
      if (g < buffer) {
        const stub = Math.min(p.e.day + 4, days);
        ghost += ` H ${x(stub)}`;
        ghostEnd = { x: x(stub), v: g };
        break;
      }
    }
  }
  const biggest = points.filter((p) => p.e.kind === "bill").sort((a, b) => a.e.delta - b.e.delta)[0];

  return (
    <figure className="mt-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label="Operating balance over the next five weeks">
        {/* Below the buffer: the zone the Steward keeps the balance out of */}
        <rect x={PAD.l} y={y(buffer)} width={plotW} height={y(yMin) - y(buffer)} fill="var(--red)" opacity="0.06" />
        <line x1={PAD.l} x2={PAD.l + plotW} y1={y(buffer)} y2={y(buffer)} stroke="var(--red)" strokeWidth="1" strokeDasharray="4 4" opacity="0.8" />
        <text x={PAD.l + 6} y={y(buffer) + 16} fontSize="12" fill="var(--graphite)">
          Buffer {buffer.toFixed(1)}
        </text>

        {/* Recessive time axis */}
        <line x1={PAD.l} x2={PAD.l + plotW} y1={y(yMin)} y2={y(yMin)} stroke="var(--rule)" />
        {dates.map((t) => (
          <g key={t.day}>
            <line x1={x(t.day)} x2={x(t.day)} y1={y(yMin)} y2={y(yMin) + 5} stroke="var(--rule)" />
            <text x={x(t.day)} y={H - 8} fontSize="12" textAnchor="middle" fill="var(--graphite)">
              {t.label}
            </text>
          </g>
        ))}

        {ghost ? <path d={ghost} fill="none" stroke="var(--graphite)" strokeWidth="1.5" strokeDasharray="1.5 4" strokeLinecap="round" /> : null}
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />

        {/* The redemption rise, in signature ink */}
        {redeem ? (
          <g>
            <line x1={x(redeem.e.day)} x2={x(redeem.e.day)} y1={y(redeem.before)} y2={y(redeem.after)} stroke="var(--seal)" strokeWidth="3" />
            <text x={x(redeem.e.day) - 10} y={y(redeem.after) - 12} fontSize="12.5" textAnchor="end" fill="var(--ink)">
              <tspan fontWeight="600">+{redeem.e.delta.toFixed(1)} from reserve</tspan>
              <tspan x={x(redeem.e.day) - 10} dy="15" fill="var(--graphite)">
                two days before the big bill
              </tspan>
            </text>
          </g>
        ) : null}

        {biggest ? (
          <text x={x(biggest.e.day) + 10} y={(y(biggest.before) + y(biggest.after)) / 2} fontSize="12.5" fill="var(--ink)">
            <tspan fontWeight="600">{biggest.e.label}</tspan>
            <tspan x={x(biggest.e.day) + 10} dy="15" fill="var(--graphite)">
              −{Math.abs(biggest.e.delta).toFixed(1)}
            </tspan>
          </text>
        ) : null}

        {ghostEnd ? (
          <g>
            <circle cx={ghostEnd.x} cy={y(ghostEnd.v)} r="3.5" fill="var(--paper)" stroke="var(--graphite)" strokeWidth="1.5" />
            <text x={ghostEnd.x + 10} y={y(ghostEnd.v) + 4} fontSize="12" fill="var(--graphite)">
              {ghostEnd.v.toFixed(1)} without the reserve move
            </text>
          </g>
        ) : null}

        <circle cx={x(days)} cy={y(end)} r="4" fill="var(--ink)" />
        <text x={PAD.l + plotW + 10} y={y(end) + 4} fontSize="13" fontWeight="600" fill="var(--ink)">
          {end.toFixed(1)}
        </text>
        <text x={x(0)} y={y(start) - 10} fontSize="12" fill="var(--graphite)">
          Today {start.toFixed(1)}
        </text>

        {/* Hover targets on every step, bigger than the mark */}
        {points.map((p) => (
          <g key={p.e.day + p.e.label}>
            <rect x={x(p.e.day) - 12} y={Math.min(y(p.before), y(p.after)) - 8} width="24" height={Math.abs(y(p.before) - y(p.after)) + 16} fill="transparent">
              <title>{`${p.e.label}: ${p.e.delta > 0 ? "+" : "−"}${Math.abs(p.e.delta).toFixed(1)} → ${p.after.toFixed(1)}`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">
        Operating balance starts at {start.toFixed(1)} thousand USDC and ends at {end.toFixed(1)}, staying above the {buffer} buffer.
      </figcaption>
    </figure>
  );
}
