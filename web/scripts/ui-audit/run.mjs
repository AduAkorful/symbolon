// UI audit driver (plan 05zb, Q5). Renders pages of a running, seeded local app in headless Chrome at several widths, injects
// harness.js, opens every dialog and checks it, and exits non-zero when a hard rule is broken.
//
//   node scripts/ui-audit/run.mjs --tokens tokens.json [--base http://localhost:3000] [--set owner|vendor|public|all]
//        [--widths 1440,375] [--only /business/treasury,/vendor] [--dialogs] [--out out-dir] [--chrome /usr/bin/google-chrome]
//
// tokens.json: { "owner": "<session token>", "vendor": "<session token>", "vendorFingerprint": "0x…" }. Sessions are made in
// the app's own database by the seed; the audit never signs in through Privy.
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true;
};
const BASE = arg("base", "http://localhost:3000");
const OUT = arg("out", join(here, "out"));
const widths = String(arg("widths", "1440,375")).split(",").map(Number);
const only = arg("only", "") ? String(arg("only")).split(",") : null;
const set = arg("set", "all");
const dialogs = arg("dialogs", false) !== false;
const tokens = JSON.parse(readFileSync(arg("tokens", join(here, "tokens.json")), "utf8"));
const harness = readFileSync(join(here, "harness.js"), "utf8");
mkdirSync(join(OUT, "shots"), { recursive: true });

const OWNER = ["/business", "/business/inbox", "/business/approvals", "/business/vendors", "/business/orders", "/business/treasury", "/business/steward", "/business/policy", "/business/activity", "/business/accounting", "/business/compliance", "/business/team", "/business/settings", "/business/settings/releases", "/business/ask", "/notifications", "/profile"];
const VENDOR = ["/vendor", "/vendor/invoices", "/vendor/new", "/vendor/upload", "/vendor/series", "/vendor/settings", "/vendor/verify", "/vendor/clients"];
const PUBLIC = ["/", "/status", "/stats", "/verify", "/signin"];
const MISC = [
  { who: null, path: `/invoice/${tokens.vendorFingerprint}` },
  { who: null, path: "/join/not-a-real-token", expect: 404 },
  { who: null, path: "/invite/not-a-real-token", expect: 404 },
  { who: null, path: "/this-page-does-not-exist", expect: 404 },
  { who: "owner", path: "/setup" },
  { who: "vendor", path: "/vendor/start" },
];
const jobs = [
  ...(set === "all" || set === "owner" ? OWNER.map((path) => ({ who: "owner", path })) : []),
  ...(set === "all" || set === "vendor" ? VENDOR.map((path) => ({ who: "vendor", path })) : []),
  ...(set === "all" || set === "public" ? PUBLIC.map((path) => ({ who: null, path })) : []),
  ...(set === "all" || set === "misc" ? MISC : []),
].filter((j) => !only || only.some((o) => j.path === o || j.path.startsWith(o + "/")));

// Rules whose findings fail the run. Everything else is reported.
const HARD = ["h-overflow", "wrapped-hex", "no-padding", "dialog-padding", "no-name", "input-no-label", "contrast", "small-text", "off-screen", "dead-link", "structure", "hydration"];
const slug = (p) => (p === "/" ? "root" : p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 50));

const browser = await chromium.launch({ executablePath: arg("chrome", process.env.CHROME_PATH || "/usr/bin/google-chrome"), headless: true, args: ["--no-sandbox"] });

async function open(width, who, path) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  if (who) await ctx.addCookies([{ name: "symbolon_session", value: tokens[who], domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  page.__hydration = [];
  page.on("console", (m) => { if (/hydrat|didn.t match|mismatch/i.test(m.text())) page.__hydration.push(m.text().slice(0, 300)); });
  const resp = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 120000 });
  try { await page.waitForSelector("h1", { state: "visible", timeout: 60000 }); } catch { /* reported by the harness as a heading problem */ }
  try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch { /* long-lived connections */ }
  await page.waitForTimeout(400);
  return { ctx, page, status: resp?.status() };
}
const audit = (page, scope) => page.evaluate(({ h, sel }) => { if (!window.__auditDoc) (0, eval)(h); return window.__auditDoc(document, window, sel ? document.querySelector(sel) : undefined); }, { h: harness, sel: scope });

async function dialogPass(page, path, width) {
  const found = [];
  const skip = /sign out|log out|run now|pause|resume|delete|revoke|copy|skip to|connect|continue with|ask the steward|next\.js dev tools|in the vault$|^continue$/i;
  const labels = await page.$$eval("button, [role=radio]", (els) => els.filter((e) => e.offsetParent !== null && !e.disabled).map((e) => (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 50)));
  const seen = new Set();
  for (const label of labels) {
    if (!label || seen.has(label) || skip.test(label)) continue;
    seen.add(label);
    const el = page.getByRole("button", { name: label, exact: true }).first();
    if (!(await el.count())) continue;
    try { await el.scrollIntoViewIfNeeded(); await el.click({ timeout: 2500 }); } catch { continue; }
    await page.waitForTimeout(500);
    if (await page.locator('[role="dialog"]').count()) {
      const geo = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]'); if (!d) return null; const r = d.getBoundingClientRect();
        const framed = [...d.querySelectorAll("*")].filter((e) => { const cs = getComputedStyle(e); return parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderTopLeftRadius) >= 12 && e.getBoundingClientRect().width > r.width * 0.6; }).length;
        const head = d.querySelector("h2")?.getBoundingClientRect();
        return { width: Math.round(r.width), nestedFrames: framed, titleInset: head ? Math.round(head.left - r.left) : null, title: (d.querySelector("h2")?.textContent || "").trim() };
      });
      if (!geo) continue; // it closed by itself
      const a = await audit(page, '[role="dialog"]');
      if (geo.nestedFrames) (a["nested-frame"] ||= []).push(`${geo.nestedFrames} framed boxes inside the dialog`);
      if (geo.titleInset !== null && geo.titleInset < 16) (a["dialog-padding"] ||= []).push(`title ${geo.titleInset}px from the edge`);
      if (!geo.title) (a["no-title"] ||= []).push("dialog has no title");
      await page.screenshot({ path: join(OUT, "shots", `dlg-${slug(path)}-${width}-${slug(label)}.png`) });
      found.push({ opener: label, geo, issues: a });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      if (await page.locator('[role="dialog"]').count()) (found.at(-1).issues["escape"] ||= []).push("Escape does not close it");
    }
  }
  return found;
}

const results = [];
let failures = 0;
for (const job of jobs) {
  for (const width of widths) {
    let rec;
    try {
      const { ctx, page, status } = await open(width, job.who, job.path);
      const issues = await audit(page);
      if (page.__hydration?.length) issues["hydration"] = page.__hydration;
      await page.screenshot({ path: join(OUT, "shots", `${slug(job.path)}-${width}.png`), fullPage: true });
      rec = { path: job.path, width, status, issues };
      if (dialogs && width >= 1024) rec.dialogs = await dialogPass(page, job.path, width);
      await ctx.close();
    } catch (e) { rec = { path: job.path, width, error: String(e).slice(0, 200) }; }
    results.push(rec);
    const hard = rec.error ? ["error"] : [
      ...Object.keys(rec.issues || {}).filter((k) => HARD.includes(k)),
      ...(rec.dialogs || []).flatMap((d) => Object.keys(d.issues).filter((k) => HARD.includes(k) || ["nested-frame", "no-title", "escape"].includes(k))),
    ];
    if (hard.length || (rec.status && rec.status >= 400 && rec.status !== job.expect)) failures++;
    console.log(`${hard.length || (rec.status >= 400 && rec.status !== job.expect) ? "FAIL" : "ok  "} ${job.path} @${width} ${rec.status ?? ""} ${[...new Set(hard)].join(", ")}`);
  }
}
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 1));
await browser.close();
console.log(`\n${results.length} renders, ${failures} with hard failures. Details: ${join(OUT, "results.json")}`);
process.exit(failures ? 1 : 0);
