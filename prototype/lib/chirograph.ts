/**
 * The chirograph cut: a wavy edge generated from an invoice fingerprint. Both halves use the same seam, so only the
 * true pair fits. Geometry is in percentages of height and pixels of width, so it scales with the document.
 */

export interface Seam {
  /** Offsets in px, one per sample, in [-amplitude, amplitude] */
  offsets: number[];
  amplitude: number;
}

/** Deterministic seam from a hex fingerprint: a sum of three sines whose phases and frequencies come from its bytes */
export function seamFor(fingerprint: string, amplitude = 10, samples = 48): Seam {
  const hex = fingerprint.replace(/^0x/, "").padEnd(12, "0");
  const byte = (i: number) => parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255;
  const waves = [0, 1, 2].map((k) => ({
    freq: 2 + Math.round(byte(k) * 4) + k * 2,
    phase: byte(k + 3) * Math.PI * 2,
    weight: [0.6, 0.28, 0.12][k]!,
  }));
  const offsets = Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const v = waves.reduce((sum, w) => sum + w.weight * Math.sin(t * Math.PI * w.freq + w.phase), 0);
    return Math.round(v * amplitude * 10) / 10;
  });
  return { offsets, amplitude };
}

const pct = (i: number, n: number) => `${((i / n) * 100).toFixed(3)}%`;

/** clip-path for the vendor's half: straight left edge, cut on the right */
export function vendorClip({ offsets, amplitude }: Seam): string {
  const n = offsets.length - 1;
  const edge = offsets.map((o, i) => `calc(100% - ${amplitude}px + ${o}px) ${pct(i, n)}`);
  return `polygon(0 0, ${edge.join(", ")}, 0 100%)`;
}

/** clip-path for the payer's half: cut on the left (the complement), straight right edge */
export function payerClip({ offsets, amplitude }: Seam): string {
  const n = offsets.length - 1;
  const edge = offsets.map((o, i) => `calc(${amplitude}px + ${o}px) ${pct(i, n)}`).reverse();
  return `polygon(100% 0, 100% 100%, ${edge.join(", ")})`;
}
