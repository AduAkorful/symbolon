/**
 * Storyboard thumbnails: schematic 160×100 drawings built from a few primitives. Dashed arrows mean movement, as in a
 * hand-drawn storyboard. Colours are the product's roles (ink, seal, red, rule) so the boards preview the system.
 */

export type Tone = "ink" | "seal" | "red" | "ghost";
export type Shape =
  | { t: "doc"; x: number; y: number; w: number; h: number; cut?: "r" | "l"; tone?: Tone; fill?: boolean }
  | { t: "rows"; x: number; y: number; w: number; n: number; gap?: number; tone?: Tone }
  | { t: "stamp"; x: number; y: number; r?: number; tone?: Tone; word?: string }
  | { t: "text"; x: number; y: number; s: string; size?: number; tone?: Tone; serif?: boolean; anchor?: "start" | "middle" | "end" }
  | { t: "arrow"; x1: number; y1: number; x2: number; y2: number; tone?: Tone }
  | { t: "btn"; x: number; y: number; w: number; s: string; filled?: boolean; tone?: Tone }
  | { t: "scatter"; x: number; y: number; w: number; h: number; tone?: Tone }
  | { t: "phone"; x: number; y: number; w?: number; h?: number }
  | { t: "bar"; x: number; y: number; w: number; h: number; tone?: Tone; outline?: boolean }
  | { t: "tick"; x: number; y: number; tone?: Tone; cross?: boolean }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; tone?: Tone; dash?: boolean; w?: number }
  | { t: "step"; pts: [number, number][]; tone?: Tone; dash?: boolean };

const color = (t: Tone = "ink") =>
  t === "seal" ? "var(--seal)" : t === "red" ? "var(--red)" : t === "ghost" ? "var(--graphite)" : "var(--ink)";

// A gentle chirograph wave for vertical edges, height h starting at y
const wave = (x: number, y: number, h: number, dir: 1 | -1) => {
  const n = 6;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const yy = y + (i / n) * h;
    const xx = x + dir * (i % 2 ? 2.2 : -2.2);
    d += `${i ? "L" : "M"} ${xx} ${yy} `;
  }
  return d;
};

function Draw({ s }: { s: Shape }) {
  switch (s.t) {
    case "doc": {
      const c = color(s.tone);
      const fill = s.fill === false ? "none" : "var(--paper-raised)";
      if (!s.cut)
        return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={fill} stroke={c} strokeWidth="0.8" strokeDasharray={s.tone === "ghost" ? "2 2" : undefined} />;
      const edge = s.cut === "r" ? wave(s.x + s.w, s.y, s.h, 1) : wave(s.x, s.y, s.h, -1);
      const box =
        s.cut === "r"
          ? `M ${s.x + s.w} ${s.y} L ${s.x} ${s.y} L ${s.x} ${s.y + s.h} L ${s.x + s.w} ${s.y + s.h}`
          : `M ${s.x} ${s.y} L ${s.x + s.w} ${s.y} L ${s.x + s.w} ${s.y + s.h} L ${s.x} ${s.y + s.h}`;
      return (
        <g>
          <path d={`${box} ${edge.replace(/^M/, "L")} Z`} fill={fill} stroke="none" />
          <path d={box} fill="none" stroke={c} strokeWidth="0.8" strokeDasharray={s.tone === "ghost" ? "2 2" : undefined} />
          <path d={edge} fill="none" stroke={c} strokeWidth="0.8" strokeDasharray="1 1.5" />
        </g>
      );
    }
    case "rows":
      return (
        <g>
          {Array.from({ length: s.n }, (_, i) => (
            <line key={i} x1={s.x} x2={s.x + s.w} y1={s.y + i * (s.gap ?? 5)} y2={s.y + i * (s.gap ?? 5)} stroke={color(s.tone ?? "ghost")} strokeWidth="0.6" opacity="0.7" />
          ))}
        </g>
      );
    case "stamp":
      return (
        <g transform={`rotate(-8 ${s.x} ${s.y})`}>
          {s.word ? (
            <>
              <rect x={s.x - 17} y={s.y - 5} width="34" height="10" fill="var(--paper-raised)" stroke={color(s.tone ?? "seal")} strokeWidth="0.9" />
              <text x={s.x} y={s.y + 2.3} fontSize="5.4" textAnchor="middle" letterSpacing="1" fill={color(s.tone ?? "seal")} fontFamily="var(--font-geist-mono)">
                {s.word}
              </text>
            </>
          ) : (
            <>
              <circle cx={s.x} cy={s.y} r={s.r ?? 6} fill="none" stroke={color(s.tone ?? "seal")} strokeWidth="0.9" />
              <circle cx={s.x} cy={s.y} r={(s.r ?? 6) * 0.55} fill="none" stroke={color(s.tone ?? "seal")} strokeWidth="0.6" />
            </>
          )}
        </g>
      );
    case "text":
      return (
        <text
          x={s.x}
          y={s.y}
          fontSize={s.size ?? 5}
          textAnchor={s.anchor ?? "start"}
          fill={color(s.tone)}
          fontFamily={s.serif ? "var(--font-caslon)" : "var(--font-schibsted)"}
        >
          {s.s}
        </text>
      );
    case "arrow": {
      const c = color(s.tone ?? "seal");
      const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const hx = (a: number) => s.x2 - 3.2 * Math.cos(ang + a);
      const hy = (a: number) => s.y2 - 3.2 * Math.sin(ang + a);
      return (
        <g>
          <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={c} strokeWidth="0.9" strokeDasharray="2 1.6" />
          <path d={`M ${hx(0.5)} ${hy(0.5)} L ${s.x2} ${s.y2} L ${hx(-0.5)} ${hy(-0.5)}`} fill="none" stroke={c} strokeWidth="0.9" />
        </g>
      );
    }
    case "btn":
      return (
        <g>
          <rect x={s.x} y={s.y} width={s.w} height="7" rx="1" fill={s.filled ? color(s.tone) : "none"} stroke={color(s.tone)} strokeWidth="0.7" />
          <text x={s.x + s.w / 2} y={s.y + 4.9} fontSize="3.8" textAnchor="middle" fill={s.filled ? "var(--paper)" : color(s.tone)} fontFamily="var(--font-schibsted)">
            {s.s}
          </text>
        </g>
      );
    case "scatter": {
      const pts = Array.from({ length: 26 }, (_, i) => {
        const a = (i * 2654435761) % 1000;
        return [s.x + ((a % 97) / 97) * s.w * ((i % 7) / 7 + 0.3), s.y + (((a * 7) % 89) / 89) * s.h] as const;
      });
      return (
        <g>
          {pts.map(([px, py], i) => (
            <rect key={i} x={px} y={py} width={i % 4 ? 1.2 : 2} height={i % 4 ? 1.2 : 2} fill={color(s.tone ?? "red")} opacity={1 - i / 30} />
          ))}
        </g>
      );
    }
    case "phone":
      return <rect x={s.x} y={s.y} width={s.w ?? 44} height={s.h ?? 84} rx="5" fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth="0.9" />;
    case "bar":
      return (
        <rect
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          fill={s.outline ? "none" : color(s.tone)}
          stroke={color(s.tone)}
          strokeWidth={s.outline ? 0.8 : 0}
          opacity={s.outline ? 1 : 0.9}
        />
      );
    case "tick":
      return s.cross ? (
        <path d={`M ${s.x - 1.8} ${s.y - 1.8} L ${s.x + 1.8} ${s.y + 1.8} M ${s.x + 1.8} ${s.y - 1.8} L ${s.x - 1.8} ${s.y + 1.8}`} stroke={color(s.tone ?? "red")} strokeWidth="0.9" />
      ) : (
        <path d={`M ${s.x - 2} ${s.y} L ${s.x - 0.5} ${s.y + 1.6} L ${s.x + 2.2} ${s.y - 1.8}`} fill="none" stroke={color(s.tone ?? "seal")} strokeWidth="0.9" />
      );
    case "line":
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color(s.tone)} strokeWidth={s.w ?? 0.8} strokeDasharray={s.dash ? "2 2" : undefined} />;
    case "step":
      return (
        <polyline
          points={s.pts.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke={color(s.tone)}
          strokeWidth="0.9"
          strokeDasharray={s.dash ? "1 2" : undefined}
        />
      );
  }
}

export function Sketch({ shapes, label }: { shapes: Shape[]; label: string }) {
  return (
    <svg viewBox="0 0 160 100" className="block w-full rounded-doc border border-rule bg-paper" role="img" aria-label={label}>
      {shapes.map((s, i) => (
        <Draw key={i} s={s} />
      ))}
    </svg>
  );
}
