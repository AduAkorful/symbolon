/** A decorative QR-style mark for the link (demo only, not scannable) */
export function QR({ seed, className = "h-32 w-32 rounded-sm bg-paper-raised p-2" }: { seed: string; className?: string }) {
  const n = 21;
  const bits = seed.replace(/^0x/, "").split("").flatMap((h) => parseInt(h, 16).toString(2).padStart(4, "0").split("").map(Number));
  const finder = (x: number, y: number) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  const inFinder = (x: number, y: number) => {
    const fx = x < 7 ? x : x - (n - 7);
    const fy = y < 7 ? y : y - (n - 7);
    return fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
  };
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className={className} aria-label="Link code (demo)">
      {Array.from({ length: n * n }, (_, i) => {
        const x = i % n;
        const y = Math.floor(i / n);
        const on = finder(x, y) ? inFinder(x, y) : bits[(i * 7) % bits.length] === 1;
        return on ? <rect key={i} x={x} y={y} width="1" height="1" fill="var(--ink)" /> : null;
      })}
    </svg>
  );
}
