/**
 * The refusal's borrowed moment (from direction C): the seam letters of a document that can't be matched break into
 * fragments that drift away from the cut. Static here (a style frame); the animated version uses the same layout.
 */

// Small deterministic generator so server and client render the same fragments
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function Scatter({ text, seed = 7, className = "" }: { text: string; seed?: number; className?: string }) {
  const r = rng(seed);
  const letters = text.split("");
  const holdUntil = Math.floor(letters.length * 0.35);
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 select-none overflow-visible ${className}`}>
      {letters.map((ch, i) => {
        const drift = i < holdUntil ? 0 : (i - holdUntil + 1) / (letters.length - holdUntil);
        const x = drift * (12 + r() * 46);
        const y = (r() - 0.5) * drift * 60;
        const rot = (r() - 0.5) * drift * 90;
        const opacity = 0.55 - drift * 0.45;
        return (
          <span
            key={i}
            data-frag="letter"
            className="absolute left-0 font-mono text-[22px] leading-none text-red"
            style={{ top: `${6 + i * (88 / letters.length)}%`, transform: `translate(${x}px, ${y}px) rotate(${rot}deg)`, opacity }}
          >
            {ch}
          </span>
        );
      })}
      {Array.from({ length: 46 }, (_, i) => {
        const t = r();
        const x = 6 + t * t * 70;
        const top = 30 + r() * 64;
        const size = 2 + Math.round(r() * 3);
        return (
          <span
            key={`p${i}`}
            data-frag="dust"
            className="absolute bg-red"
            style={{ left: x, top: `${top}%`, width: size, height: size, opacity: 0.5 - t * 0.4 }}
          />
        );
      })}
    </div>
  );
}
