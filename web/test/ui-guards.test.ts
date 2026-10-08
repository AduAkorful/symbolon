import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The shared fixes of plan 05za (B1–B9) hold only if screens keep using them. These guards read the source of every screen
// and fail on the habits that caused the audit's findings, so a new screen can't bring them back.

const root = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "api" || name === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

const screens = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "components"))];
// the landing and legal pages, the prototype-style public pages and the status page have their own copy and layout
const own = (file: string) => /app\/page\.tsx|app\/status|app\/signin|components\/landing|components\/signin|not-found|global-error|error\.tsx/.test(file);

function offenders(pattern: RegExp, allow: (file: string) => boolean = () => false) {
  return screens
    .filter((file) => !allow(relative(root, file)))
    .flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, i) => (pattern.test(line) ? [`${relative(root, file)}:${i + 1}: ${line.trim().slice(0, 100)}`] : [])));
}

describe("screens use the shared formatters (plan 05za)", () => {
  it("never print a date through the browser's locale (B3): use formatDay / formatDateTime", () => {
    expect(offenders(/\.toLocaleDateString\(|\.toLocaleTimeString\(|new Date\([^)]*\)\.toLocaleString\(/, own)).toEqual([]);
  });

  it("never print an ISO date slice (B3)", () => {
    expect(offenders(/toISOString\(\)\.slice\(\s*0\s*,\s*(10|19)\s*\)/, (f) => own(f) || /vendor\/invoices\/\[fingerprint\]\/early\/page/.test(f))).toEqual([]); // that page hands a date to an input's value, it prints nothing
  });

  it("never turn a token amount into a floating-point number to print it (B1): use showMoney / showAmount", () => {
    expect(offenders(/Number\(formatUnits\(|parseFloat\(.*formatUnits/, own)).toEqual([]);
  });

  it("never tell a person about raw units or a 'Vendor seal' column (B2/B9)", () => {
    expect(offenders(/raw token units|raw units|in token units|>Vendor seal<|Vendor Seal address/, own)).toEqual([]);
  });

  it("has one <main> per page: the shell's (B7)", () => {
    const standalone = /app\/page\.tsx|app\/signin|app\/status|app\/stats|app\/setup|app\/join|app\/invite|app\/invoice|app\/receipt|app\/verify|app\/vendor\/onboarding|components\/vendor\/Onboarding|components\/setup\/Setup|components\/receipt\/ReceiptView|components\/public|components\/landing|components\/signin|not-found|error\.tsx|global-error|NoAccess|components\/shell\/Shell/;
    expect(offenders(/<main[\s>]/, (f) => standalone.test(f))).toEqual([]);
  });

  it("keeps inner page wrappers left-aligned with the header (B7): no centring inside the shell", () => {
    const inShell = screens.filter((f) => /app\/(business|vendor|notifications|profile)\//.test(relative(root, f)) || /components\/(ask|profile|policy|treasury|settings|activity|accounting|team|steward|orders|inbox|home|approvals|compliance|decisions|vendors|business|notifications)\//.test(relative(root, f)));
    const found = inShell.flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, i) => (/className="[^"]*\bmx-auto\b[^"]*\bmax-w-/.test(line) && !/NoAccess|error\.tsx/.test(file) ? [`${relative(root, file)}:${i + 1}`] : [])));
    expect(found).toEqual([]);
  });
});

// Plan 05zb: the shared pieces (Overlay frame, Button, Field, type scale, StatusPill, Money, Address, tokens) only work if screens
// keep using them. These fail on the habits that produced the audit's findings.
describe("screens use the shared UI pieces (plan 05zb)", () => {
  // the public landing page has its own art direction; QR codes draw dark on light by design; ui/ is where the pieces are defined
  const ownArt = (file: string) => /components\/public\/Landing|components\/QR|components\/ui\//.test(file);

  it("uses colour tokens, never raw palette colours (S8): ok, warn, red, seal and their washes", () => {
    expect(offenders(/\b(?:bg|text|border|ring|from|to|divide|fill|stroke|decoration|outline|accent)-(?:amber|red|emerald|green|yellow|orange|blue|sky|indigo|violet|purple|pink|rose|slate|gray|zinc|neutral|stone|lime|teal|cyan)-\d{2,3}\b/, ownArt)).toEqual([]);
    expect(offenders(/\b(?:bg|text|border)-(?:white|black)\b/, ownArt)).toEqual([]);
    expect(offenders(/\b(?:bg|text|border|ring|divide)-(?:brass|crimson|emerald|surface|paper-soft|rule-strong)\b/, ownArt)).toEqual([]);
  });

  it("has no dark: variants: the app is dark only (S8)", () => {
    expect(offenders(/\bdark:/, ownArt)).toEqual([]);
  });

  it("has no text under 12 px (S9)", () => {
    expect(offenders(/text-\[(?:\d|1[01])(?:\.\d+)?px\]/, ownArt)).toEqual([]);
  });

  it("never uses tabular-nums, which draws wide punctuation in this typeface (S7)", () => {
    expect(offenders(/tabular-nums/, ownArt)).toEqual([]);
  });

  it("opens every dialog through Overlay, and draws no frame of its own inside one (S1)", () => {
    const usesOverlay = screens.filter((f) => /<Overlay\b/.test(readFileSync(f, "utf8")) && !/components\/Overlay\.tsx$/.test(f));
    const found = usesOverlay.flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, i) => (/rounded-2xl|fixed inset-0/.test(line) ? [`${relative(root, file)}:${i + 1}`] : [])));
    expect(found).toEqual([]);
    expect(offenders(/fixed inset-0/, (f) => /components\/Overlay\.tsx$/.test(f) || ownArt(f))).toEqual([]);
  });

  it("never asks with the browser's alert() or confirm() (S11)", () => {
    // comments may name the thing they replace; AddPayee has its own `confirm()` that checks a receipt
    expect(offenders(/^(?!\s*(?:\*|\/\/)).*(?<![.\w])(?:alert|confirm)\(/, (f) => ownArt(f) || /components\/inbox\/AddPayee|lib\/client/.test(f))).toEqual([]);
  });

  it("styles buttons through buttonClass / Button, not a class string of its own (S2)", () => {
    expect(offenders(/className="[^"]*\bbg-ink\b[^"]*\btext-paper\b/, (f) => ownArt(f) || /app\/layout|components\/(Overlay|ask\/AskView|shell\/BusinessNav|shell\/VendorNav)/.test(f))).toEqual([]);
  });

  it("sets page titles and section titles through PageTitle / SectionTitle (S4)", () => {
    const inShell = (file: string) => !(/app\/page\.tsx|app\/status|app\/signin|app\/setup|app\/join|app\/invite|app\/invoice|app\/receipt|app\/verify|vendor\/onboarding|not-found|error\.tsx|global-error|components\/(public|signin|setup|receipt)|Onboarding|Verify|NoAccess|Chirograph|Marks/.test(file));
    expect(offenders(/<h1\b[^>]*className=/, (f) => !inShell(f) || ownArt(f))).toEqual([]);
    expect(offenders(/<h2\b[^>]*className="[^"]*font-display/, (f) => !inShell(f) || ownArt(f))).toEqual([]);
  });

  it("caps no signed-in page at its own width: the shell's container sets it (S5)", () => {
    const shellPage = (file: string) => /app\/(business|vendor|notifications|profile)\//.test(file) && !/vendor\/onboarding|vendor\/start/.test(file);
    expect(offenders(/max-w-\[(?:[7-9]\d\d|1[0-9]\d\d)px\]/, (f) => !shellPage(f))).toEqual([]);
  });

  it("gives every address a width it can use: no break-all on the Address component (S6)", () => {
    expect(offenders(/<Address\b[^>]*break-all/, ownArt)).toEqual([]);
  });

  it("keeps every \"use client\" directive on the first line (an import above it breaks the build of that page)", () => {
    const found = screens.filter((f) => /^[^\n]*\n[\s\S]*?^"use client";/m.test(readFileSync(f, "utf8")) && !readFileSync(f, "utf8").startsWith('"use client"')).map((f) => relative(root, f));
    expect(found).toEqual([]);
  });

  it("writes titles and eyebrows in sentence case (S4, S12): only product names keep a capital", () => {
    const names = /Symbolon|Arc\b|Circle|Privy|USYC|EURC|USDC|Seal|Vault|Steward|Early Pay|Ask the/;
    const titled = /<(?:PageTitle|SectionTitle|SmallTitle|Eyebrow)\b[^>]*>[A-Z][a-z]+(?: [A-Z][a-z]+)+[^<{]*<|\btitle="[A-Z][a-z]+(?: [A-Z][a-z]+)+[^"]*"/;
    const found = screens.flatMap((file) =>
      readFileSync(file, "utf8").split("\n").flatMap((line, i) => (titled.test(line) && !names.test(line) ? [`${relative(root, file)}:${i + 1}: ${line.trim().slice(0, 100)}`] : []))
    );
    expect(found).toEqual([]);
  });
});
