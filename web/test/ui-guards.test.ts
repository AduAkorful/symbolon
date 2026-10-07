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
    const standalone = /app\/page\.tsx|app\/signin|app\/status|app\/setup|app\/join|app\/invite|app\/invoice|app\/receipt|app\/verify|app\/vendor\/onboarding|components\/vendor\/Onboarding|components\/setup\/Setup|components\/receipt\/ReceiptView|components\/public|components\/landing|components\/signin|not-found|error\.tsx|global-error|NoAccess|components\/shell\/Shell/;
    expect(offenders(/<main[\s>]/, (f) => standalone.test(f))).toEqual([]);
  });

  it("keeps inner page wrappers left-aligned with the header (B7): no centring inside the shell", () => {
    const inShell = screens.filter((f) => /app\/(business|vendor|notifications|profile)\//.test(relative(root, f)) || /components\/(ask|profile|policy|treasury|settings|activity|accounting|team|steward|orders|inbox|home|approvals|compliance|decisions|vendors|business|notifications)\//.test(relative(root, f)));
    const found = inShell.flatMap((file) => readFileSync(file, "utf8").split("\n").flatMap((line, i) => (/className="[^"]*\bmx-auto\b[^"]*\bmax-w-/.test(line) && !/NoAccess|error\.tsx/.test(file) ? [`${relative(root, file)}:${i + 1}`] : [])));
    expect(found).toEqual([]);
  });
});
