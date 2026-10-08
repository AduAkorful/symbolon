import { seamFor } from "@/lib/chirograph";

/**
 * The logo's own cut, drawn large and faint behind the sign-in screens (plan 05zh): two document halves along the wavy seam of
 * demo invoice 0143 (the fingerprint the mark itself is cut from, `prototype/lib/ana.ts`), the left pale and the right periwinkle.
 * Decoration only: no data, no pointer events, hidden from assistive tech and from print. Motion lives in `globals.css`
 * (`.seal-*`) and is off under reduced motion.
 */
const FINGERPRINT = "0x3d9b0e17c4a28f5e6b01d93a7c2e48f16a05b9d2e37c81f40a6d2b95c1e7f308";
const W = 1600;
const H = 1000;
const CENTER = W / 2;
const AMPLITUDE = 38;
const SAMPLES = 48;
const BLEED = 600;

const seam = seamFor(FINGERPRINT, AMPLITUDE, SAMPLES);
const points = seam.offsets.map((o, i) => [CENTER + o, (i / SAMPLES) * H] as const);
const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
const down = points.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
// each half is closed far outside the picture, so its outer edge is never seen
const leftHalf = `M ${-BLEED} 0 ${down} L ${-BLEED} ${H} Z`;
const rightHalf = `M ${W + BLEED} 0 ${down} L ${W + BLEED} ${H} Z`;

export function SealBackdrop() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="seal-backdrop pointer-events-none absolute inset-0 -z-10 h-full w-full select-none print:hidden">
      <defs>
        <pattern id="seal-rule-left" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d="M0 63.5 H64" stroke="var(--ink)" strokeOpacity="0.07" strokeWidth="1" />
        </pattern>
        <pattern id="seal-rule-right" width="64" height="64" patternUnits="userSpaceOnUse">
          <path d="M0 63.5 H64" stroke="var(--seal)" strokeOpacity="0.14" strokeWidth="1" />
        </pattern>
      </defs>
      <g className="seal-half seal-left">
        <path d={leftHalf} fill="var(--ink)" fillOpacity="0.03" />
        <path d={leftHalf} fill="url(#seal-rule-left)" />
      </g>
      <g className="seal-half seal-right">
        <path d={rightHalf} fill="var(--seal)" fillOpacity="0.06" />
        <path d={rightHalf} fill="url(#seal-rule-right)" />
      </g>
      <path d={line} className="seal-seam" pathLength={1} fill="none" stroke="var(--seal)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
      <path d={line} className="seal-glint" pathLength={1} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
