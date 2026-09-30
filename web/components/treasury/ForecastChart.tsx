"use client";

import { useState } from "react";

export interface ForecastEvent {
  day: number;
  delta: number;
  label: string;
  kind: "bill" | "redeem";
}

export interface ForecastDate {
  day: number;
  label: string;
}

const W = 1000;
const H = 300;
const PAD = { l: 16, r: 120, t: 28, b: 36 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

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

  // Determine vertical scale dynamically
  let minVal = Math.min(start, buffer);
  let maxVal = Math.max(start, buffer);
  let running = start;
  for (const e of events) {
    running += e.delta;
    if (running < minVal) minVal = running;
    if (running > maxVal) maxVal = running;
  }

  // Margin around limits
  const yMin = Math.max(0, Math.floor(minVal * 0.85));
  const yMax = Math.max(10, Math.ceil(maxVal * 1.15));

  const x = (d: number) => PAD.l + (Math.max(0, Math.min(d, days)) / days) * plotW;
  const y = (v: number) => {
    if (yMax <= yMin) return PAD.t + plotH / 2;
    return PAD.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  };

  // Stepped path
  let bal = start;
  let d = `M ${x(0)} ${y(bal)}`;
  const points: { e: ForecastEvent; before: number; after: number }[] = [];

  const sortedEvents = [...events].sort((a, b) => a.day - b.day);
  for (const e of sortedEvents) {
    d += ` H ${x(e.day)}`;
    const before = bal;
    bal += e.delta;
    d += ` V ${y(bal)}`;
    points.push({ e, before, after: bal });
  }
  d += ` H ${x(days)}`;
  const end = bal;

  const redeem = points.find((p) => p.e.kind === "redeem");
  const biggestBill = points.filter((p) => p.e.kind === "bill").sort((a, b) => a.e.delta - b.e.delta)[0];

  return (
    <div className="mt-6">
      <div className="flex items-center justify-end gap-2 mb-2">
        <button
          type="button"
          onClick={() => setViewMode("chart")}
          className={`text-xs px-2.5 py-1 rounded ${
            viewMode === "chart" ? "bg-ink text-paper font-medium" : "text-graphite hover:text-ink"
          }`}
        >
          Visual
        </button>
        <button
          type="button"
          onClick={() => setViewMode("table")}
          className={`text-xs px-2.5 py-1 rounded ${
            viewMode === "table" ? "bg-ink text-paper font-medium" : "text-graphite hover:text-ink"
          }`}
        >
          Data table
        </button>
      </div>

      {viewMode === "chart" ? (
        <figure className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full overflow-visible"
            role="img"
            aria-label="Operating balance over the forecast period"
          >
            {/* Buffer zone */}
            {buffer > yMin && (
              <>
                <rect
                  x={PAD.l}
                  y={y(buffer)}
                  width={plotW}
                  height={Math.max(0, y(yMin) - y(buffer))}
                  fill="var(--red, #ef4444)"
                  opacity="0.06"
                />
                <line
                  x1={PAD.l}
                  x2={PAD.l + plotW}
                  y1={y(buffer)}
                  y2={y(buffer)}
                  stroke="var(--red, #ef4444)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  opacity="0.8"
                />
                <text x={PAD.l + 6} y={y(buffer) + 16} fontSize="12" fill="var(--graphite, #666)">
                  Buffer {buffer.toLocaleString("en-US", { maximumFractionDigits: 1 })}k
                </text>
              </>
            )}

            {/* Time axis */}
            <line x1={PAD.l} x2={PAD.l + plotW} y1={y(yMin)} y2={y(yMin)} stroke="var(--rule, #e5e5e5)" />
            {dates.map((t) => (
              <g key={t.day + t.label}>
                <line x1={x(t.day)} x2={x(t.day)} y1={y(yMin)} y2={y(yMin) + 5} stroke="var(--rule, #e5e5e5)" />
                <text x={x(t.day)} y={H - 8} fontSize="12" textAnchor="middle" fill="var(--graphite, #666)">
                  {t.label}
                </text>
              </g>
            ))}

            {/* Stepped line */}
            <path d={d} fill="none" stroke="var(--ink, #111)" strokeWidth="2" strokeLinejoin="round" />

            {/* Event annotations */}
            {redeem && (
              <g>
                <line
                  x1={x(redeem.e.day)}
                  x2={x(redeem.e.day)}
                  y1={y(redeem.before)}
                  y2={y(redeem.after)}
                  stroke="var(--seal, #0f766e)"
                  strokeWidth="3"
                />
                <text x={x(redeem.e.day) - 10} y={y(redeem.after) - 10} fontSize="12" textAnchor="end" fill="var(--ink, #111)">
                  <tspan fontWeight="600">+{redeem.e.delta.toFixed(1)}k from reserve</tspan>
                </text>
              </g>
            )}

            {biggestBill && (
              <text
                x={x(biggestBill.e.day) + 8}
                y={(y(biggestBill.before) + y(biggestBill.after)) / 2}
                fontSize="12"
                fill="var(--ink, #111)"
              >
                <tspan fontWeight="600">{biggestBill.e.label}</tspan>
                <tspan dx="4" fill="var(--graphite, #666)">
                  −{Math.abs(biggestBill.e.delta).toFixed(1)}k
                </tspan>
              </text>
            )}

            {/* End point and start point */}
            <circle cx={x(days)} cy={y(end)} r="4" fill="var(--ink, #111)" />
            <text x={PAD.l + plotW + 10} y={y(end) + 4} fontSize="13" fontWeight="600" fill="var(--ink, #111)">
              {end.toLocaleString("en-US", { maximumFractionDigits: 1 })}k
            </text>
            <text x={x(0)} y={y(start) - 10} fontSize="12" fill="var(--graphite, #666)">
              Today {start.toLocaleString("en-US", { maximumFractionDigits: 1 })}k
            </text>

            {/* Tooltips */}
            {points.map((p) => (
              <g key={p.e.day + p.e.label}>
                <rect
                  x={x(p.e.day) - 12}
                  y={Math.min(y(p.before), y(p.after)) - 8}
                  width="24"
                  height={Math.abs(y(p.before) - y(p.after)) + 16}
                  fill="transparent"
                >
                  <title>{`${p.e.label}: ${p.e.delta > 0 ? "+" : "−"}${Math.abs(p.e.delta).toFixed(2)}k → ${p.after.toFixed(2)}k`}</title>
                </rect>
              </g>
            ))}
          </svg>
          <figcaption className="sr-only">
            Operating balance starts at {start.toFixed(1)}k and ends at {end.toFixed(1)}k over {days} days.
          </figcaption>
        </figure>
      ) : (
        <div className="overflow-x-auto max-h-[300px] border border-rule rounded-doc">
          <table className="w-full text-left text-xs">
            <thead className="bg-paper-raised border-b border-rule sticky top-0">
              <tr>
                <th className="px-3 py-2 font-medium">Day</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium text-right">Outflows</th>
                <th className="px-3 py-2 font-medium text-right">Inflows</th>
                <th className="px-3 py-2 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule font-mono tabular-nums">
              {tableRows.map((r) => (
                <tr key={r.day} className="hover:bg-paper-raised/50">
                  <td className="px-3 py-1.5">{r.day}</td>
                  <td className="px-3 py-1.5 font-sans">{r.date}</td>
                  <td className="px-3 py-1.5 text-right">{r.outflows !== "0" ? `-${r.outflows}` : "—"}</td>
                  <td className="px-3 py-1.5 text-right">{r.inflows !== "0" ? `+${r.inflows}` : "—"}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{r.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
