import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";

/**
 * Symbolon's motion system. Motion carries meaning: only changes to money, trust or time move. Every animation runs
 * *from* a starting state *to* the designed screen, so the resting markup is always the finished state and reduced
 * motion simply shows it.
 */

/** Durations in seconds */
export const D = {
  /** Ticks, crosses, presses */
  tick: 0.12,
  /** Digits rolling, hover, small state flips */
  quick: 0.18,
  /** Default UI change: a panel opening, a tag appearing */
  base: 0.3,
  /** A row arriving in a list */
  arrive: 0.42,
  /** Blur-to-sharp headlines; shared-element moves */
  move: 0.5,
  /** The match closing; sealing */
  deliberate: 0.7,
  /** The refusal's break-up; the only cinematic duration */
  cinematic: 0.9,
} as const;

/** Stagger between siblings, seconds */
export const S = {
  /** Extracted fields filling in */
  field: 0.06,
  /** Ledger lines writing in */
  row: 0.09,
  /** Letters (code digits, the seam) */
  letter: 0.035,
} as const;

/** Named eases; the cubic-bezier values are also exported as CSS variables in globals.css */
export const EASES = {
  /** Things entering: fast start, long soft landing */
  arrive: "0.16, 1, 0.3, 1",
  /** State changes inside a view */
  settle: "0.2, 0, 0, 1",
  /** Things leaving */
  depart: "0.4, 0, 1, 1",
  /** The halves closing: a 2 px-scale overshoot, then settle */
  close: "M0,0 C0.24,0 0.14,1.05 0.6,1.03 0.8,1.01 0.9,1 1,1",
  /** A stamp striking: overshoot in, quick settle */
  strike: "M0,0 C0.25,0.4 0.35,1.12 0.55,1.06 0.75,1 0.85,1 1,1",
} as const;

export type EaseName = keyof typeof EASES;
export const E = (name: EaseName) => `sym.${name}`;

let registered = false;
export function registerMotion() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(CustomEase);
  for (const [name, def] of Object.entries(EASES)) {
    // Cubic-bezier tokens become the SVG path form CustomEase expects: M0,0 C x1,y1 x2,y2 1,1
    const path = def.startsWith("M")
      ? def
      : (() => {
          const [x1, y1, x2, y2] = def.split(",").map((n) => n.trim());
          return `M0,0 C${x1},${y1} ${x2},${y2} 1,1`;
        })();
    CustomEase.create(`sym.${name}`, path);
  }
  registered = true;
}

/** Reduced-motion map: what each motion becomes when the person asks for less */
export const REDUCED: { motion: string; becomes: string }[] = [
  { motion: "Rows sliding in, cards rising", becomes: "Appear in place (150 ms fade)" },
  { motion: "Numbers rolling", becomes: "Final number shown" },
  { motion: "Headline blur-to-sharp", becomes: "Headline shown" },
  { motion: "The halves closing", becomes: "Closed halves shown, stamp in place" },
  { motion: "The refusal's break-up", becomes: "Fragments shown at rest; no drift" },
  { motion: "Shared-element moves", becomes: "Cut between states" },
  { motion: "Countdowns", becomes: "Unchanged (they're information, not decoration)" },
];

// ——— Helpers used by scenes. Each adds `from` motion to a timeline at `at`, ending on the markup's own state. ———

type Tl = gsap.core.Timeline;
type Pos = gsap.Position;

/**
 * A number rolls from `from` to the value already in the element's text. Written through a setter (not a callback) so
 * the text is right on every render, including when the timeline is scrubbed or jumped.
 */
export function roll(tl: Tl, el: Element | null, from: number, at: Pos, dur: number = D.move, decimals = 2) {
  if (!el) return;
  const text = el.textContent ?? "0";
  // Keep a leading currency symbol ($, €) while the digits roll
  const prefix = text.match(/^[^\d-]*/)?.[0] ?? "";
  const to = Number(text.replace(/[^0-9.-]/g, ""));
  const fmt = (v: number) => prefix + v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  let current = to;
  const proxy = {
    get v() {
      return current;
    },
    set v(x: number) {
      current = x;
      el.textContent = fmt(x);
    },
  };
  tl.fromTo(proxy, { v: from }, { v: to, duration: dur, ease: E("settle") }, at);
}

/** Text resolves from scrambled characters to its own content, left to right (addresses, codes) */
export function resolveText(tl: Tl, el: Element | null, at: Pos, dur = 0.6, alphabet = "0123456789abcdef") {
  if (!el) return;
  const final = el.textContent ?? "";
  // Deterministic scramble so the same moment always looks the same when scrubbed
  const noise = Array.from(final, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]!);
  let p = 1;
  const proxy = {
    get v() {
      return p;
    },
    set v(x: number) {
      p = x;
      const n = Math.floor(x * final.length);
      el.textContent = final.slice(0, n) + Array.from(final.slice(n), (c, i) => (c === "…" || c === " " ? c : noise[n + i])).join("");
    },
  };
  tl.fromTo(proxy, { v: 0 }, { v: 1, duration: dur, ease: "none" }, at);
}

/** Headlines resolve from a blur */
export function blurIn(tl: Tl, targets: gsap.TweenTarget, at: Pos) {
  tl.from(targets, { opacity: 0, filter: "blur(12px)", y: 8, duration: D.move, ease: E("arrive") }, at);
}

/** A line of text or a rule writes in left to right */
export function writeIn(tl: Tl, targets: gsap.TweenTarget, at: Pos, stagger: number = S.row) {
  tl.from(targets, { clipPath: "inset(0 100% 0 0)", duration: D.arrive, ease: E("settle"), stagger }, at);
}

/** SVG strokes draw on (ticks, crosses, edges); paths need pathLength="1" */
export function draw(tl: Tl, targets: gsap.TweenTarget, at: Pos, stagger = 0, dur: number = D.tick * 2) {
  tl.from(targets, { strokeDashoffset: 1, duration: dur, ease: E("settle"), stagger }, at);
}

/** A stamp strikes */
export function strike(tl: Tl, targets: gsap.TweenTarget, at: Pos) {
  tl.from(targets, { scale: 1.14, opacity: 0, duration: D.quick + 0.06, ease: E("strike") }, at);
}

/** Something arrives from an offset */
export function arrive(tl: Tl, targets: gsap.TweenTarget, at: Pos, vars: gsap.TweenVars = {}) {
  tl.from(targets, { opacity: 0, y: 16, duration: D.arrive, ease: E("arrive"), ...vars }, at);
}
