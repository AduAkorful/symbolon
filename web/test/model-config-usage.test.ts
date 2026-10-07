import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Plan 05x: whether a model is configured is `config.model`, never one vendor's key, and no screen names a vendor's key.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === ".next" || n === "test") return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.(tsx?|mjs)$/.test(n) ? [p] : [];
  });
}

describe("the model setting", () => {
  const root = join(__dirname, "..");
  const files = ["app", "components", "lib"].flatMap((d) => sources(join(root, d)));

  it("is read through config.model only", () => {
    const hits = files.filter((f) => /anthropicApiKey/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("is not named to people: no screen or message mentions a vendor's key", () => {
    const hits = files.filter((f) => /ANTHROPIC_API_KEY|OPENROUTER_API_KEY|Anthropic (API )?key/i.test(readFileSync(f, "utf8")) && !f.endsWith("load-config.ts"));
    expect(hits).toEqual([]);
  });
});

describe("no stand-ins in the app (operator, 2026-09-29, 2026-10-07)", () => {
  const root = join(__dirname, "..");
  const files = ["app", "components", "lib"].flatMap((d) => sources(join(root, d)));

  it("the scripted test model is not part of the package's main entry", async () => {
    const steward = await import("@symbolon/steward");
    expect("FakeStewardModel" in steward).toBe(false);
  });

  it("no app source imports the testing entry", () => {
    expect(files.filter((f) => /@symbolon\/steward\/testing/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("no app source names a stand-in person or company", () => {
    const hits = files.filter((f) => /"Unknown vendor"|'Unknown vendor'|John Doe|Jane Doe/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
