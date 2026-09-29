"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { D, E, EASES, S, type EaseName, registerMotion } from "@/lib/motion";

const EASE_NOTES: Record<EaseName, string> = {
  arrive: "Things entering: rows, cards, sheets",
  settle: "Changes inside a view: rolling numbers, lines writing in",
  depart: "Things leaving",
  close: "The halves closing: one small overshoot",
  strike: "A stamp striking; a paid amount landing",
};

function EaseCard({ name }: { name: EaseName }) {
  const [d, setD] = useState("");
  const dot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerMotion();
    setD(CustomEase.getSVGData(E(name), { width: 200, height: 120 }) as string);
  }, [name]);
  const play = () => {
    if (!dot.current) return;
    gsap.fromTo(dot.current, { x: 0 }, { x: 220, duration: D.deliberate, ease: E(name) });
  };
  return (
    <li className="rounded-doc border border-rule bg-paper-raised p-5">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-sm">{E(name)}</p>
        <button onClick={play} className="text-sm text-seal underline decoration-rule underline-offset-4">
          Play
        </button>
      </div>
      <svg viewBox="-10 -30 220 170" className="mt-3 w-full" aria-label={`Curve for ${name}`}>
        <line x1="0" y1="120" x2="200" y2="120" stroke="var(--rule)" />
        <line x1="0" y1="0" x2="200" y2="0" stroke="var(--rule-soft)" strokeDasharray="3 3" />
        {d ? <path d={d} fill="none" stroke="var(--seal)" strokeWidth="2" /> : null}
      </svg>
      <div className="relative mt-2 h-4">
        <div ref={dot} className="absolute left-0 top-0.5 h-3 w-3 rounded-full bg-ink" />
      </div>
      <p className="mt-2 text-sm text-graphite">{EASE_NOTES[name]}</p>
      <p className="mt-1 font-mono text-[11px] text-graphite/80 break-all">{EASES[name]}</p>
    </li>
  );
}

export function MotionSpecimens() {
  const max = D.cinematic;
  return (
    <div className="space-y-16">
      <section aria-labelledby="durations">
        <h2 id="durations" className="font-display text-3xl">
          Durations
        </h2>
        <ul className="mt-5 border-t border-ink">
          {Object.entries(D).map(([k, v]) => (
            <li key={k} className="grid grid-cols-[8rem_4rem_1fr] items-center gap-4 border-b border-rule py-3">
              <span className="font-mono text-sm">{k}</span>
              <span className="text-right text-sm tabular-nums">{Math.round(v * 1000)} ms</span>
              <span className="h-2 bg-ink" style={{ width: `${(v / max) * 100}%` }} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="eases">
        <h2 id="eases" className="font-display text-3xl">
          Eases
        </h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(EASES) as EaseName[]).map((n) => (
            <EaseCard key={n} name={n} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="stagger">
        <h2 id="stagger" className="font-display text-3xl">
          Staggers
        </h2>
        <ul className="mt-5 border-t border-ink">
          {Object.entries(S).map(([k, v]) => (
            <li key={k} className="grid grid-cols-[8rem_4rem_1fr] gap-4 border-b border-rule py-3 text-sm">
              <span className="font-mono">{k}</span>
              <span className="text-right tabular-nums">{Math.round(v * 1000)} ms</span>
              <span className="text-graphite">
                {k === "field" ? "Extracted fields filling in" : k === "row" ? "Ledger lines writing in; ticks follow their line" : "Digits of a code; seam letters"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
