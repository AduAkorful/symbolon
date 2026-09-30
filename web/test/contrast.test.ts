import { describe, expect, it } from "vitest";

/**
 * WCAG 2.2 Relative Luminance and Contrast Ratio calculation
 * Specification: https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    const c0 = clean[0]!;
    const c1 = clean[1]!;
    const c2 = clean[2]!;
    return [
      parseInt(c0 + c0, 16),
      parseInt(c1 + c1, 16),
      parseInt(c2 + c2, 16),
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  throw new Error(`Invalid hex color: ${hex}`);
}

function sRgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const rLin = sRgbToLinear(r);
  const gLin = sRgbToLinear(g);
  const bLin = sRgbToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Tokens from web/app/globals.css (:root dark palette)
export const tokens = {
  paper: "#131a16",
  paperRaised: "#1a231e",
  rule: "#3b4a41",
  ruleSoft: "#26322b",
  ink: "#e4ebe0",
  graphite: "#93a298",
  seal: "#9fb0f5",
  sealWash: "#20284a",
  red: "#ef8a7c",
  redWash: "#3a1f1b",
};

describe("WCAG 2.2 AA Contrast Audit (Decision L12)", () => {
  it("verifies test mathematical rigor by rejecting poor contrast pairs", () => {
    // Bad pair: dark gray on black
    const badDark = contrastRatio("#333333", "#111111");
    expect(badDark).toBeLessThan(3.0);

    // Bad pair: light yellow on white
    const badLight = contrastRatio("#ffffcc", "#ffffff");
    expect(badLight).toBeLessThan(3.0);
  });

  describe("Text token pairs (requires >= 4.5:1 for normal text)", () => {
    it("ink on paper exceeds 4.5:1", () => {
      const ratio = contrastRatio(tokens.ink, tokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(12.0); // Typically ~14:1
    });

    it("ink on paper-raised exceeds 4.5:1", () => {
      const ratio = contrastRatio(tokens.ink, tokens.paperRaised);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(10.0);
    });

    it("graphite on paper exceeds 4.5:1", () => {
      const ratio = contrastRatio(tokens.graphite, tokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(6.0);
    });

    it("graphite on paper-raised exceeds 4.5:1", () => {
      const ratio = contrastRatio(tokens.graphite, tokens.paperRaised);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(5.5);
    });

    it("seal text on paper exceeds 4.5:1", () => {
      const ratio = contrastRatio(tokens.seal, tokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("seal text on seal-wash exceeds 4.5:1", () => {
      const ratio = contrastRatio(tokens.seal, tokens.sealWash);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("red text on paper exceeds 4.5:1", () => {
      const ratio = contrastRatio(tokens.red, tokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("red text on red-wash exceeds 4.5:1", () => {
      const ratio = contrastRatio(tokens.red, tokens.redWash);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("UI Components & Focus Rings (requires >= 3.0:1)", () => {
    it("seal focus ring outline against paper background exceeds 3.0:1", () => {
      const ratio = contrastRatio(tokens.seal, tokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    it("seal focus ring outline against paper-raised background exceeds 3.0:1", () => {
      const ratio = contrastRatio(tokens.seal, tokens.paperRaised);
      expect(ratio).toBeGreaterThanOrEqual(3.0);
    });

    it("rule border on paper provides distinct boundary", () => {
      const ratio = contrastRatio(tokens.rule, tokens.paper);
      // Border lines in dark mode
      expect(ratio).toBeGreaterThanOrEqual(1.5);
    });
  });

  describe("Print palette contrast (light background)", () => {
    const printTokens = {
      paper: "#ffffff",
      ink: "#15211c",
      graphite: "#5d6b63",
      seal: "#2b3a8c",
      red: "#b23a2e",
    };

    it("print ink on white paper exceeds 4.5:1", () => {
      const ratio = contrastRatio(printTokens.ink, printTokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeGreaterThan(14.0);
    });

    it("print graphite on white paper exceeds 4.5:1", () => {
      const ratio = contrastRatio(printTokens.graphite, printTokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("print seal on white paper exceeds 4.5:1", () => {
      const ratio = contrastRatio(printTokens.seal, printTokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it("print red on white paper exceeds 4.5:1", () => {
      const ratio = contrastRatio(printTokens.red, printTokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  });
});
