"use client";

import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { Half } from "@/components/Chirograph";
import { SealStamp } from "@/components/Marks";
import { QR } from "@/components/QR";
import { D, E, registerMotion, strike } from "@/lib/motion";
import { Act } from "@/components/Act";
import { Overlay } from "@/components/Overlay";

interface Line {
  id: number;
  description: string;
  qty: string;
  price: string;
}
interface Tier {
  id: number;
  pct: string;
  days: string;
}

const clientsList = [
  { name: "Acme Operations", on: true, email: "finance@acme.example", pos: ["PO-0031 · Design retainer", "PO-0036 · Brand refresh, $2,400.00 left"] },
  { name: "Halden Retail", on: true, email: "ap@halden.example", pos: [] as string[] },
  { name: "Kite & Co", on: false, email: "hello@kite.example", pos: [] as string[] },
];

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A 64-hex-digit pseudo fingerprint of the draft, so the preview's cut changes as the content does (demo only) */
function draftFingerprint(s: string) {
  let out = "";
  for (let k = 0; k < 8; k++) {
    let h = 0x811c9dc5 ^ k;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return `0x${out}`;
}

const cents = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const fmt = (c: number) => (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Step = "edit" | "confirm" | "sealing" | "sent";

/** The composer (V4) with seal and send (V6). `prefill` comes from an uploaded PDF (V5). */
export function Composer({ prefill }: { prefill?: { client: string; lines: Omit<Line, "id">[] } }) {
  const [client, setClient] = useState(prefill?.client ?? "Acme Operations");
  const [po, setPo] = useState<string | null>("PO-0036 · Brand refresh, $2,400.00 left");
  const [currency, setCurrency] = useState<"USDC" | "EURC">("USDC");
  const [chain, setChain] = useState("Arc");
  const [dueDays, setDueDays] = useState("30");
  const [lines, setLines] = useState<Line[]>(
    (prefill?.lines ?? [
      { description: "Brand refresh — type and colour system", qty: "1", price: "1600" },
      { description: "Launch templates", qty: "8", price: "100" },
    ]).map((l, i) => ({ ...l, id: i + 1 })),
  );
  const [taxPct, setTaxPct] = useState("0");
  const [earlyOn, setEarlyOn] = useState(true);
  const [tiers, setTiers] = useState<Tier[]>([
    { id: 1, pct: "1.5", days: "3" },
    { id: 2, pct: "0.75", days: "15" },
  ]);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("edit");

  const c = clientsList.find((x) => x.name === client)!;
  const lineCents = lines.map((l) => {
    const q = Number(l.qty);
    const p = cents(l.price);
    return Number.isFinite(q) && Number.isFinite(p) ? Math.round(q * p) : NaN;
  });
  const subtotal = lineCents.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const tax = Math.round((subtotal * (Number(taxPct) || 0)) / 100);
  const total = subtotal + tax;
  const problems = [
    ...lines.flatMap((l, i) => (!l.description.trim() ? [`Line ${i + 1} needs a description`] : !(Number(l.qty) > 0) || !(cents(l.price) > 0) ? [`Line ${i + 1} needs a quantity and a price`] : [])),
    ...(total <= 0 ? ["The total must be more than zero"] : []),
    ...(earlyOn ? tiers.filter((t) => !(Number(t.pct) > 0 && Number(t.pct) < 10 && Number(t.days) > 0)).map(() => "Each Early Pay tier needs a discount under 10% and a number of days") : []),
  ];

  const fingerprint = useMemo(
    () => draftFingerprint(JSON.stringify({ client, po, currency, chain, dueDays, lines, taxPct, earlyOn, tiers, notes, files })),
    [client, po, currency, chain, dueDays, lines, taxPct, earlyOn, tiers, notes, files],
  );

  // Sealing: the stamp strikes, then the edge is cut top to bottom and the fingerprint writes down it
  const preview = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (step !== "sealing") return;
    if (reduced() || !preview.current) {
      setStep("sent");
      return;
    }
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ onComplete: () => setStep("sent") });
      strike(tl, "[data-a=stamp]", 0.1);
      tl.from('[data-seam="line"], [data-seam="letters"]', { clipPath: "inset(0 0 100% 0)", duration: 0.6, ease: E("settle") }, 0.3);
      tl.to({}, { duration: 0.5 });
    }, preview);
    return () => ctx.revert();
  }, [step]);

  const box = "rounded-doc border border-rule bg-paper px-3 py-2 text-[15px] focus:border-ink focus:outline-none";
  const input = `w-full ${box}`;
  const sealed = step === "sealing" || step === "sent";

  const doc = (
    <div ref={preview} className="drop-shadow-[0_14px_24px_rgba(21,33,28,0.10)]">
      <Half side="vendor" fingerprint={fingerprint} className="bg-paper-raised" tone={sealed ? "var(--seal)" : "var(--rule)"} seamClassName={sealed ? "" : "opacity-0"}>
        <div className="px-7 py-8 pr-14">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-display text-3xl leading-none">Studio Ana</p>
              <p className="mt-1 font-mono text-xs text-graphite">@studio-ana</p>
            </div>
            {sealed ? (
              <div data-a="stamp">
                <SealStamp handle="@studio-ana" size={64} className="-mt-1 rotate-[-8deg]" />
              </div>
            ) : (
              <span className="rounded-full border border-dashed border-rule px-3 py-1 text-xs text-graphite">Not sealed</span>
            )}
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-y-2 border-y border-rule py-3 text-sm">
            <dt className="text-graphite">Invoice</dt>
            <dd className="text-right">No. 0144</dd>
            <dt className="text-graphite">To</dt>
            <dd className="text-right">{client}</dd>
            <dt className="text-graphite">Due</dt>
            <dd className="text-right">in {dueDays} days</dd>
            {po && c.on ? (
              <>
                <dt className="text-graphite">PO</dt>
                <dd className="text-right">{po.split(" · ")[0]}</dd>
              </>
            ) : null}
          </dl>
          <ul className="mt-4 text-sm">
            {lines.map((l, i) => (
              <li key={l.id} className="flex justify-between gap-4 border-b border-rule-soft py-2">
                <span className="line-clamp-2">{l.description || <span className="text-graphite">Untitled line</span>}</span>
                <span className="tabular-nums">{Number.isFinite(lineCents[i]) ? fmt(lineCents[i]!) : "—"}</span>
              </li>
            ))}
            {tax ? (
              <li className="flex justify-between border-b border-rule-soft py-2 text-graphite">
                <span>Tax {taxPct}%</span>
                <span className="tabular-nums">{fmt(tax)}</span>
              </li>
            ) : null}
          </ul>
          <p className="mt-4 flex items-baseline justify-between border-t-2 border-ink pt-3">
            <span className="text-sm">Total</span>
            <span className="font-display text-3xl">
              {fmt(total)} <span className="text-sm text-graphite">{currency}</span>
            </span>
          </p>
          {earlyOn ? (
            <p className="mt-3 text-xs text-graphite">
              Early Pay: {tiers.map((t) => `${t.pct}% within ${t.days} days → ${fmt(Math.round(total * (1 - (Number(t.pct) || 0) / 100)))}`).join(" · ")}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-graphite">
            Paid in {currency} on {currency === "EURC" ? "Arc" : chain} to 0x7a3f…c219
          </p>
          {files.length ? <p className="mt-1 text-xs text-graphite">Attached: {files.join(", ")}</p> : null}
        </div>
      </Half>
      <p className="mt-3 font-mono text-[11px] text-graphite">
        {sealed ? "Fingerprint " : "Fingerprint if sealed now "}
        {fingerprint.slice(0, 10)}…{fingerprint.slice(-6)}
      </p>
      {!sealed ? <p className="text-xs text-graphite">Change any character and the fingerprint, and the cut, change with it.</p> : null}
    </div>
  );

  if (step === "sent")
    return (
      <main className="px-6 pb-24 pt-10 md:px-10">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>{doc}</div>
          <section aria-labelledby="sent" className="lg:pt-6">
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">Sealed and sent</p>
            <h1 id="sent" className="mt-2 font-display text-5xl leading-none">
              Invoice 0144 is on its way.
            </h1>
            <p className="mt-3 text-graphite">
              {c.on
                ? `${client} is on Symbolon: it’s in their inbox now, and their Steward will match it to ${po?.split(" · ")[0] ?? "their order"}.`
                : `${client} isn’t on Symbolon yet. They get a link and a PDF; paying through it sets them up.`}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <QR seed={fingerprint} />
              <div className="space-y-3">
                <p className="font-mono text-sm">symbolon.xyz/i/{fingerprint.slice(2, 10)}</p>
                <div className="flex flex-wrap gap-2">
                  <Act className="rounded-doc border border-rule px-3 py-2 text-sm hover:border-ink" copy={`/p/invoice`} done="Link copied">Copy link</Act>
                  <Act className="rounded-doc border border-rule px-3 py-2 text-sm hover:border-ink" open="/p/invoice/pdf" done="PDF opened in a new tab">Download PDF</Act>
                </div>
                <p className="text-sm text-graphite">Emailed to {c.email}</p>
              </div>
            </div>
            <div className="mt-10 flex gap-3">
              <Link href="/v/invoices" className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
                Back to invoices
              </Link>
              <Link href="/p/invoice" className="rounded-doc border border-rule px-4 py-2.5 text-sm hover:border-ink">
                See what {client.split(" ")[0]} sees
              </Link>
            </div>
          </section>
        </div>
      </main>
    );

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 className="font-display text-5xl">New invoice</h1>
      <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <form
          className="space-y-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problems.length) setStep("confirm");
          }}
        >
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Client</legend>
            <select value={client} onChange={(e) => setClient(e.target.value)} className={input} aria-label="Client">
              {clientsList.map((x) => (
                <option key={x.name}>{x.name}</option>
              ))}
            </select>
            <p className="text-xs text-graphite">{c.on ? `${client} is on Symbolon.` : `${client} isn’t on Symbolon yet; they’ll get a link and a PDF.`}</p>
            {c.on && c.pos.length ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Open purchase orders">
                {c.pos.map((p) => (
                  <button
                    type="button"
                    key={p}
                    aria-pressed={po === p}
                    onClick={() => setPo(po === p ? null : p)}
                    className={`rounded-full border px-3 py-1 text-xs ${po === p ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : null}
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium sm:col-span-3">Payment</legend>
            <label className="text-sm">
              <span className="text-graphite">Currency</span>
              <span className="mt-1 flex overflow-hidden rounded-doc border border-rule">
                {(["USDC", "EURC"] as const).map((k) => (
                  <button
                    type="button"
                    key={k}
                    aria-pressed={currency === k}
                    onClick={() => setCurrency(k)}
                    className={`flex-1 py-2 text-sm ${currency === k ? "bg-ink text-paper" : ""}`}
                  >
                    {k}
                  </button>
                ))}
              </span>
            </label>
            <label className="text-sm">
              <span className="text-graphite">Chain</span>
              <select value={currency === "EURC" ? "Arc" : chain} disabled={currency === "EURC"} onChange={(e) => setChain(e.target.value)} className={`${input} mt-1 disabled:opacity-60`}>
                {["Arc", "Base", "Ethereum", "Arbitrum", "Solana"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-graphite">Due in</span>
              <select value={dueDays} onChange={(e) => setDueDays(e.target.value)} className={`${input} mt-1`}>
                {["14", "30", "45"].map((x) => (
                  <option key={x} value={x}>
                    {x} days
                  </option>
                ))}
              </select>
            </label>
            {currency === "EURC" ? <p className="text-xs text-graphite sm:col-span-3">EURC is paid on Arc. Choose USDC to be paid on another chain.</p> : null}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">Items</legend>
            <div className="mt-3 space-y-2">
              {lines.map((l, i) => (
                <div key={l.id} className="grid grid-cols-[1fr_4rem_6.5rem_2rem] gap-2">
                  <input aria-label={`Line ${i + 1} description`} className={input} value={l.description} onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, description: e.target.value } : x)))} />
                  <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" className={`${input} text-right`} value={l.qty} onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, qty: e.target.value } : x)))} />
                  <input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" className={`${input} text-right`} value={l.price} onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, price: e.target.value } : x)))} />
                  <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines(lines.filter((x) => x.id !== l.id))} className="rounded-doc text-graphite hover:text-red disabled:opacity-30">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setLines([...lines, { id: Date.now(), description: "", qty: "1", price: "" }])} className="text-sm underline decoration-rule underline-offset-4">
                Add a line
              </button>
              <label className="flex items-center gap-2 text-sm">
                Tax
                <input aria-label="Tax percent" inputMode="decimal" className={`${box} w-16 text-right`} value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />%
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="flex w-full items-center justify-between text-sm font-medium">
              Early Pay
              <label className="flex items-center gap-2 font-normal">
                <input type="checkbox" checked={earlyOn} onChange={(e) => setEarlyOn(e.target.checked)} /> Offer a discount for paying early
              </label>
            </legend>
            {earlyOn ? (
              <div className="mt-3 space-y-2">
                {tiers.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-2 text-sm">
                    <input aria-label={`Tier ${i + 1} percent`} className={`${box} w-20 text-right`} value={t.pct} onChange={(e) => setTiers(tiers.map((x) => (x.id === t.id ? { ...x, pct: e.target.value } : x)))} />
                    % off if paid within
                    <input aria-label={`Tier ${i + 1} days`} className={`${box} w-16 text-right`} value={t.days} onChange={(e) => setTiers(tiers.map((x) => (x.id === t.id ? { ...x, days: e.target.value } : x)))} />
                    days
                    <span className="ml-auto text-graphite">you get {fmt(Math.round(total * (1 - (Number(t.pct) || 0) / 100)))}</span>
                  </div>
                ))}
                <p className="text-xs text-graphite">Your client only pays less if they pay within these days, and only by the discount you sign here.</p>
              </div>
            ) : null}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Notes and files</legend>
            <textarea rows={2} aria-label="Notes" className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the client should know" />
            <div className="flex flex-wrap items-center gap-2">
              {files.map((f) => (
                <span key={f} className="rounded-full border border-rule px-3 py-1 text-xs">
                  {f}
                </span>
              ))}
              <button type="button" onClick={() => setFiles([...files, files.length ? "deliverables.zip" : "timesheet-september.pdf"])} className="text-sm underline decoration-rule underline-offset-4">
                Attach a file
              </button>
            </div>
          </fieldset>

          <div className="border-t border-rule pt-5">
            {problems.length ? (
              <ul className="mb-3 space-y-1 text-sm text-red">
                {[...new Set(problems)].map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-seal">✓ Reconciles to the cent: {fmt(subtotal)} + {fmt(tax)} tax = {fmt(total)}</p>
            )}
            <button type="submit" disabled={!!problems.length} className="rounded-doc bg-ink px-5 py-3 font-medium text-paper disabled:opacity-40">
              Seal and send
            </button>
          </div>
        </form>

        <aside className="lg:sticky lg:top-6 lg:self-start">{doc}</aside>
      </div>

      {step === "confirm" ? (
        <Overlay aria-labelledby="seal-title">
          <div className="w-full max-w-lg rounded-t-2xl border border-rule bg-paper-raised p-7 shadow-2xl md:rounded-2xl">
            <h2 id="seal-title" className="font-display text-3xl">
              You’re sealing
            </h2>
            <p className="mt-3">
              Invoice 0144 for <strong>{fmt(total)} {currency}</strong> to {client}, paid on {currency === "EURC" ? "Arc" : chain} to your Seal’s address.
              {earlyOn ? ` Early Pay: ${tiers.map((t) => `${t.pct}% within ${t.days} days`).join(", ")}.` : ""}
            </p>
            <p className="mt-3 text-sm text-graphite">Once sealed it can’t be edited, only cancelled or corrected with a credit note.</p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setStep("sealing")} className="flex-1 rounded-doc bg-ink py-3 font-medium text-paper" autoFocus>
                Seal and send
              </button>
              <button onClick={() => setStep("edit")} className="rounded-doc border border-rule px-5 py-3">
                Keep editing
              </button>
            </div>
          </div>
        </Overlay>
      ) : null}
    </main>
  );
}
