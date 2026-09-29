"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { flows } from "@/lib/storyboards";
import { D, registerMotion } from "@/lib/motion";
import { scenes } from "./scenes";

const STAGE_W = 1280;
const STAGE_H = 800;
/** Time each beat's end state stays on screen so it can be read; held beats wait longer */
const DWELL = 1.3;
const HELD = 2.2;

interface Mark {
  at: number;
  title: string;
  motion: string;
}

export function Player() {
  const [flowId, setFlowId] = useState(flows[0]!.id);
  const [playing, setPlaying] = useState(true);
  const [slow, setSlow] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [progress, setProgress] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [total, setTotal] = useState(0);
  const [scale, setScale] = useState(1);

  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const flow = flows.find((f) => f.id === flowId)!;
  const flowScenes = scenes[flowId] ?? [];

  // Follow the system setting by default
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // Fit the 1280×800 stage to the available width
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, entry!.contentRect.width / STAGE_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build the flow's timeline: each scene appears, runs its motion, holds, then gives way to the next
  useLayoutEffect(() => {
    registerMotion();
    const stage = stageRef.current;
    if (!stage) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, onUpdate: () => setProgress(tl.progress()), onComplete: () => setPlaying(false) });
      const roots = Array.from(stage.querySelectorAll<HTMLElement>("[data-scene]"));
      gsap.set(roots, { autoAlpha: 0 });
      const found: Mark[] = [];
      let t = 0;
      flow.beats.forEach((beat, i) => {
        const root = roots[i];
        const scene = flowScenes[i];
        if (!root || !scene) return;
        const label = `beat${i}`;
        tl.addLabel(label, t);
        tl.set(root, { autoAlpha: 1 }, label);
        let built = 0;
        if (reduced) {
          tl.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.15 }, label);
        } else {
          const sub = gsap.timeline();
          sub.addLabel("s", 0);
          scene.build(sub, gsap.utils.selector(root), "s");
          built = sub.duration();
          tl.add(sub, label);
        }
        // The longer of the storyboard's timing and the scene's actual motion, so nothing is cut off
        const motion = reduced ? 0.15 : Math.max(beat.ms / 1000, built, 0.15);
        const length = motion + (beat.ms ? DWELL : HELD);
        found.push({ at: t, title: beat.title, motion: beat.motion });
        t += length;
        if (i < flow.beats.length - 1) tl.set(root, { autoAlpha: 0 }, t);
      });
      tl.set({}, {}, t);
      tlRef.current = tl;
      // Development handle for stepping through beats from the console
      if (process.env.NODE_ENV !== "production") (window as unknown as { __animatic?: gsap.core.Timeline }).__animatic = tl;
      setMarks(found);
      setTotal(t);
      setProgress(0);
      tl.timeScale(slow ? 0.5 : 1);
      if (playing) tl.play(0);
    }, stage);
    return () => {
      ctx.revert();
      tlRef.current = null;
    };
    // Rebuild only when the flow or the motion mode changes; play state and speed are applied separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, reduced]);

  useEffect(() => {
    tlRef.current?.timeScale(slow ? 0.5 : 1);
  }, [slow]);

  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    if (playing) {
      if (tl.progress() >= 1) tl.restart();
      else tl.play();
    } else tl.pause();
  }, [playing]);

  const now = progress * total;
  const current = marks.reduce((c, m, i) => (m.at <= now + 0.001 ? i : c), 0);

  const seek = (p: number) => {
    const tl = tlRef.current;
    if (!tl) return;
    tl.progress(p);
    setPlaying(false);
  };

  return (
    <div>
      <div role="tablist" aria-label="Flows" className="flex flex-wrap gap-2">
        {flows.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === flowId}
            onClick={() => {
              setFlowId(f.id);
              setPlaying(true);
            }}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-[var(--dur-quick)] ${
              f.id === flowId ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink"
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div ref={frameRef} className="mt-6 w-full">
        <div
          className="relative overflow-hidden rounded-doc border border-rule bg-paper"
          style={{ height: STAGE_H * scale }}
        >
          <div ref={stageRef} className="absolute left-0 top-0 origin-top-left" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
            {flowScenes.map((s, i) => (
              <div key={`${flowId}-${i}`} data-scene className="absolute inset-0 overflow-hidden" style={{ visibility: "hidden" }}>
                {s.render()}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="w-24 rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper"
          aria-label={playing ? "Pause the animatic" : "Play the animatic"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => {
            tlRef.current?.restart();
            setPlaying(true);
          }}
          className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
        >
          Restart
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> Half speed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Reduced motion
        </label>
        <span className="ml-auto font-mono text-xs text-graphite tabular-nums">
          {now.toFixed(1)} / {total.toFixed(1)} s
        </span>
      </div>

      <div className="relative mt-4">
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(e) => seek(Number(e.target.value) / 1000)}
          aria-label="Scrub the animatic"
          className="w-full accent-[var(--seal)]"
        />
        <ol className="relative mt-1 h-5">
          {marks.map((m, i) => (
            <li key={m.title} className="absolute top-0 -translate-x-1/2" style={{ left: `${(m.at / (total || 1)) * 100}%` }}>
              <button
                onClick={() => seek(m.at / (total || 1) + 0.0001)}
                className={`font-mono text-[11px] ${i === current ? "text-seal" : "text-graphite"}`}
                aria-label={`Go to beat ${i + 1}: ${m.title}`}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 grid gap-2 border-t border-rule pt-4 md:grid-cols-[14rem_1fr]">
        <p className="font-medium">
          <span className="mr-2 font-mono text-xs text-graphite">{current + 1}</span>
          {marks[current]?.title}
        </p>
        <p className="text-sm text-graphite">{reduced ? "Reduced motion: the end state appears with a short fade." : marks[current]?.motion}</p>
      </div>
      <p className="mt-2 text-xs text-graphite">
        Each beat’s end state holds for {DWELL} s ({HELD} s for held beats) so it can be read; in the product, the person moves on.
        Motion durations come from the storyboards; base unit {D.base * 1000} ms.
      </p>
    </div>
  );
}
