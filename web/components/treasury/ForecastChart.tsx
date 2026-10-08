"use client";

import { useEffect, useRef, useState } from "react";

import { Segmented } from "@/components/ui/Segmented";

export interface ForecastEvent {
  day: number;
  /** Change in the balance, in thousands */
  delta: number;
  label: string;
  kind: "bill" | "redeem";
}

export interface ForecastDate {
  day: number;
  label: string;
}

const H = 300;
const PAD_T = 32;
const PAD_B = 44;
const plotH = H - PAD_T - PAD_B;

/** A balance in thousands as "$20.0k" or "−$23.0k" */
const k = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;

/** A label cut to `max` characters with an ellipsis, so it can't run out of the plot */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The operating balance over the forecast as one stepped line (plan 05zb A3). Drawn at the width it is shown at, so its text is
 * a real 12 px at every screen size instead of shrinking with the picture. The vertical scale always includes zero and the
 * lowest balance, so a forecast that goes negative stays inside the plot with the zero line marked.
 */
export function ForecastChart({
  start,
  days = 35,
  buffer = 20,
  events = [],
  dates = [],
  tableRows = [],
}: {
  start: number;
  days?: number;
  buffer?: number;
  events?: ForecastEvent[];
  dates?: ForecastDate[];
  tableRows?: {
    day: number;
    date: string;
    outflows: string;
    inflows: string;
    balance: string;
  }[];
}) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode]);

  const narrow = width < 520;
  const padL = 12;
  const padR = narrow ? 76 : 104;
  const plotW = width - padL - padR;

  const sortedEvents = [...events].sort((a, b) => a.day - b.day);
  let low = Math.min(start, buffer, 0);
  let high = Math.max(start, buffer, 0);
  let running = start;
  for (const e of sortedEvents) {
    running += e.delta;
    low = Math.min(low, running);
    high = Math.max(high, running);
  }
  const span = Math.max(high - low, 10);
  const yMin = low - span * 0.08;
  const yMax = high + span * 0.12;

  const x = (d: number) => padL + (Math.max(0, Math.min(d, days)) / days) * plotW;
  const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  let bal = start;
  let path = `M ${x(0)} ${y(bal)}`;
  const points: { e: ForecastEvent; before: number; after: number }[] = [];
  for (const e of sortedEvents) {
    path += ` H ${x(e.day)}`;
    const before = bal;
    bal += e.delta;
    path += ` V ${y(bal)}`;
    points.push({ e, before, after: bal });
  }
  path += ` H ${x(days)}`;
  const end = bal;

  const redeem = points.find((p) => p.e.kind === "redeem");
  const biggestBill = points.filter((p) => p.e.kind === "bill").sort((a, b) => a.e.delta - b.e.delta)[0];
  const axisY = H - PAD_B + 6;
  const zeroVisible = yMin < 0;

  return (
    <div className="mt-6">
      <div className="mb-3 flex justify-end">
        <Segmented
          label="Show the forecast as"
          hideLabel
          value={viewMode}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
          onChange={setViewMode}
          className="w-48"
        />
      </div>

      {viewMode === "chart" ? (
        <figure ref={box} className="relative">
          <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="block max-w-full" role="img" aria-label="Operating balance over the forecast period">
            {/* below the buffer */}
            {buffer > yMin ? (
              <>
                <rect x={padL} y={y(buffer)} width={plotW} height={Math.max(0, y(yMin) - y(buffer))} fill="var(--red)" opacity="0.07" />
                <line x1={padL} x2={padL + plotW} y1={y(buffer)} y2={y(buffer)} stroke="var(--red)" strokeWidth="1" strokeDasharray="4 4" opacity="0.8" />
                <text x={padL + 6} y={y(buffer) - 6} fontSize="12" fill="var(--graphite)">
                  Buffer {k(buffer)}
                </text>
              </>
            ) : null}

            {/* zero, when the balance goes below it */}
            {zeroVisible ? (
              <>
                <line x1={padL} x2={padL + plotW} y1={y(0)} y2={y(0)} stroke="var(--graphite)" strokeWidth="1" opacity="0.6" />
                <text x={padL + plotW - 4} y={y(0) - 6} fontSize="12" textAnchor="end" fill="var(--graphite)">
                  $0
                </text>
              </>
            ) : null}

            {/* time axis */}
            <line x1={padL} x2={padL + plotW} y1={axisY - 6} y2={axisY - 6} stroke="var(--rule)" />
            {dates
              .filter((_, i) => !narrow || i % 2 === 0)
              .map((t) => (
                <g key={t.day + t.label}>
                  <line x1={x(t.day)} x2={x(t.day)} y1={axisY - 6} y2={axisY} stroke="var(--rule)" />
                  <text x={Math.min(Math.max(x(t.day), padL + 20), padL + plotW)} y={axisY + 16} fontSize="12" textAnchor="middle" fill="var(--graphite)">
                    {t.label}
                  </text>
                </g>
              ))}

            <path d={path} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />

            {redeem ? (
              <g>
                <line x1={x(redeem.e.day)} x2={x(redeem.e.day)} y1={y(redeem.before)} y2={y(redeem.after)} stroke="var(--seal)" strokeWidth="3" />
                <text x={x(redeem.e.day) - 10} y={y(redeem.after) - 10} fontSize="12" textAnchor="end" fill="var(--ink)" fontWeight="600">
                  +{k(redeem.e.delta)} from reserve
                </text>
              </g>
            ) : null}

            {biggestBill && !narrow ? (
              <text x={x(biggestBill.e.day) + 8} y={(y(biggestBill.before) + y(biggestBill.after)) / 2} fontSize="12" fill="var(--ink)">
                <tspan fontWeight="600">{clip(biggestBill.e.label, Math.max(12, Math.floor((padL + plotW - x(biggestBill.e.day) - 90) / 7)))}</tspan>
                <tspan dx="6" fill="var(--graphite)">{k(biggestBill.e.delta)}</tspan>
              </text>
            ) : null}

            <circle cx={x(days)} cy={y(end)} r="4" fill="var(--ink)" />
            <text x={padL + plotW + 10} y={y(end) + 4} fontSize="13" fontWeight="600" fill="var(--ink)">
              {k(end)}
            </text>
            <text x={x(0) + 2} y={Math.max(PAD_T - 8, y(start) - 10)} fontSize="12" fill="var(--graphite)">
              Today {k(start)}
            </text>

            {points.map((p) => (
              <rect key={p.e.day + p.e.label} x={x(p.e.day) - 12} y={Math.min(y(p.before), y(p.after)) - 8} width="24" height={Math.abs(y(p.before) - y(p.after)) + 16} fill="transparent">
                <title>{`${p.e.label}: ${p.e.delta > 0 ? "+" : "−"}${k(Math.abs(p.e.delta)).replace("$", "$")} → ${k(p.after)}`}</title>
              </rect>
            ))}
          </svg>
          <figcaption className="sr-only">
            Operating balance starts at {k(start)} and ends at {k(end)} over {days} days.
          </figcaption>
        </figure>
      ) : (
        <div ref={box} className="max-h-80 overflow-auto rounded-doc border border-rule">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-rule bg-paper-raised">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Day</th>
                <th scope="col" className="px-3 py-2 font-medium">Date</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Outflows</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Inflows</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule-soft">
              {tableRows.map((r) => (
                <tr key={r.day}>
                  <td className="px-3 py-1.5">{r.day}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.date}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">{r.outflows !== "0" ? `−${r.outflows}` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">{r.inflows !== "0" ? `+${r.inflows}` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium">{r.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
