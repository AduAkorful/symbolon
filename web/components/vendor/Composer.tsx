"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import type { InvoiceDocument } from "@symbolon/seal";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { wasRejected, type SignerPlan } from "@/components/setup/owner-signer";
import { postJson } from "@/lib/client/api";
import { D, E, registerMotion, strike } from "@/lib/motion";
import type { FromFile, Prefill } from "@/lib/server/upload";
import { signInvoice } from "./seal-signer";
import { Address } from "@/components/Address";
import { buttonClass } from "@/components/ui/button";
import { InlineError } from "@/components/ui/States";
import { Eyebrow, PageTitle } from "@/components/ui/Type";
import { controlClass, Field } from "@/components/ui/Field";
import { showAmount } from "@/lib/format";

export interface ClientOption {
  id: string;
  name: string;
  vault: string | null;
  email: string | null;
}

interface Line {
  id: number;
  description: string;
  quantity: string;
  unitPrice: string;
}
interface Tier {
  id: number;
  percent: string;
  days: string;
}

type Step = "edit" | "review" | "signing" | "sent";
interface Prepared {
  document: InvoiceDocument;
  typedData: string;
  fingerprint: string;
  warnings?: string[];
}


// ── Checks the form makes itself, so a mistake is said at its field and not at the foot of the page (plan 05zj F, SYM-32) ──────────
// A minus sign used to be deleted as it was typed (`replace(/\D/g, "")`), so "-5" quietly became "5".

const DECIMAL = /^\d+(\.\d+)?$/;

/** Exact decimal to a scaled integer (6 places), or null when it isn't a plain decimal with at most 6 places */
function scaled(text: string): bigint | null {
  const t = text.trim();
  if (!DECIMAL.test(t)) return null;
  const [whole = "0", frac = ""] = t.split(".");
  if (frac.length > 6) return null;
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
}

/** The amount as a wallet shows it: digits only, in the token's smallest unit */
function rawAmount(total: string, decimals: number): string {
  const [whole = "0", frac = ""] = total.split(".");
  return `${whole}${frac.padEnd(decimals, "0").slice(0, decimals)}`.replace(/^0+(?=\d)/, "");
}

function lineProblem(l: { quantity: string; unitPrice: string }): { quantity?: string; unitPrice?: string } {
  const out: { quantity?: string; unitPrice?: string } = {};
  const q = scaled(l.quantity);
  if (l.quantity.trim() !== "" && (q === null || q <= 0n)) out.quantity = "A quantity more than zero, up to 6 decimals.";
  const p = scaled(l.unitPrice);
  if (l.unitPrice.trim() !== "" && p === null) out.unitPrice = "A price of zero or more, like 250 or 250.50 (no minus sign).";
  return out;
}

const whole = (text: string) => /^\d+$/.test(text.trim());

/** What the lines come to, as exact digits, once every line parses: `null` while something is still wrong or empty */
function subtotalOf(lines: { quantity: string; unitPrice: string }[]): bigint | null {
  let sum = 0n;
  for (const l of lines) {
    const q = scaled(l.quantity);
    const p = scaled(l.unitPrice);
    if (q === null || p === null || q <= 0n) return null;
    sum += q * p; // scale 1e12
  }
  return sum;
}

/** A scale-1e12 integer as a decimal string, trailing zeros trimmed to at least two places */
function fromTwelve(raw: bigint): string {
  const digits = raw.toString().padStart(13, "0");
  return showAmount(`${digits.slice(0, -12)}.${digits.slice(-12)}`);
}

const DRAFT_KEY = (handle: string) => `symbolon:invoice-draft:${handle}`;

const box = controlClass;
const label = "block text-sm font-medium text-ink";
const primary = buttonClass();
const ghost = buttonClass({ variant: "secondary" });
const NEW = "new";

/** Write an invoice (V4), see the exact sealed text, sign it in your own wallet, and get its link (V6). Plan 05i. */
export function Composer({ handle, clients, nextNumber, signer, prefill, fromFile }: { handle: string; clients: ClientOption[]; nextNumber: string; signer: SignerPlan; prefill?: Prefill; fromFile?: FromFile }) {
  const discover = useWalletProviders();
  const [step, setStep] = useState<Step>("edit");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A draft read from an uploaded file fills these in; the vendor confirms every one (plan 05i, V13). It never sets the currency.
  // A file's client is matched to a saved one only on an exact name (ignoring case and spacing), and is still shown for the
  // vendor to confirm (plan 05zj F, SYM-34): it never picks a client the vendor didn't see.
  const sameName = (a: string, b: string) => a.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase() === b.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  const matchedClient = prefill?.client.name ? clients.find((c) => sameName(c.name, prefill.client.name)) : undefined;
  const [clientId, setClientId] = useState(prefill ? (matchedClient?.id ?? NEW) : (clients[0]?.id ?? NEW));
  const [newName, setNewName] = useState(prefill?.client.name ?? "");
  const [newBy, setNewBy] = useState<"vault" | "email">(prefill?.client.email ? "email" : "vault");
  const [newValue, setNewValue] = useState(prefill?.client.email ?? "");
  const [currency, setCurrency] = useState<"USDC" | "EURC">("USDC");
  const [number, setNumber] = useState(prefill?.invoiceNumber || nextNumber);
  const [dueDays, setDueDays] = useState(prefill?.dueDays || "30");
  const [po, setPo] = useState(prefill?.poNumber ?? "");
  const [lines, setLines] = useState<Line[]>(
    prefill?.lines.length ? prefill.lines.map((l, i) => ({ id: i + 1, ...l })) : [{ id: 1, description: "", quantity: "1", unitPrice: "" }],
  );
  const [tax, setTax] = useState("");
  const [earlyOn, setEarlyOn] = useState(false);
  const [tiers, setTiers] = useState<Tier[]>([{ id: 1, percent: "1.5", days: "3" }]);
  const [notes, setNotes] = useState(prefill?.notes ?? "");

  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [sent, setSent] = useState<{ fingerprint: string; path: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const nextId = useRef((prefill?.lines.length ?? 1) + 1);
  const sealedDoc = useRef<HTMLDivElement>(null);

  // An unsent draft survives a reload or a closed tab for this session (plan 05zj F, SYM-32). A file's draft takes priority, and a
  // browser that won't keep it just doesn't: nothing depends on it.
  const [restored, setRestored] = useState(false);
  const hydrated = useRef(false);
  useEffect(() => {
    if (prefill || hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY(handle));
      if (!raw) return;
      const d = JSON.parse(raw) as Record<string, unknown>;
      if (typeof d.clientId === "string" && (d.clientId === NEW || clients.some((c) => c.id === d.clientId))) setClientId(d.clientId);
      if (typeof d.newName === "string") setNewName(d.newName);
      if (d.newBy === "vault" || d.newBy === "email") setNewBy(d.newBy);
      if (typeof d.newValue === "string") setNewValue(d.newValue);
      if (d.currency === "USDC" || d.currency === "EURC") setCurrency(d.currency);
      if (typeof d.number === "string" && d.number) setNumber(d.number);
      if (typeof d.dueDays === "string") setDueDays(d.dueDays);
      if (typeof d.po === "string") setPo(d.po);
      if (Array.isArray(d.lines) && d.lines.length) {
        const ls = d.lines.filter((l): l is Line => !!l && typeof l === "object" && typeof (l as Line).id === "number").slice(0, 100);
        if (ls.length) {
          setLines(ls);
          nextId.current = Math.max(nextId.current, ...ls.map((l) => l.id)) + 1;
        }
      }
      if (typeof d.tax === "string") setTax(d.tax);
      if (typeof d.earlyOn === "boolean") setEarlyOn(d.earlyOn);
      if (Array.isArray(d.tiers) && d.tiers.length) setTiers((d.tiers as Tier[]).filter((t) => t && typeof t.id === "number").slice(0, 3));
      if (typeof d.notes === "string") setNotes(d.notes);
      setRestored(true);
    } catch {
      /* no saved draft, or a browser that won't give it back */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (prefill || !hydrated.current || step === "sent") return;
    try {
      sessionStorage.setItem(DRAFT_KEY(handle), JSON.stringify({ clientId, newName, newBy, newValue, currency, number, dueDays, po, lines, tax, earlyOn, tiers, notes }));
    } catch {
      /* private window or storage full: the draft just isn't kept */
    }
  }, [prefill, handle, step, clientId, newName, newBy, newValue, currency, number, dueDays, po, lines, tax, earlyOn, tiers, notes]);

  // The stamp strikes once the invoice is signed and saved
  useLayoutEffect(() => {
    if (step !== "sent" || !sealedDoc.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.from(sealedDoc.current, { opacity: 0, y: 10, duration: D.base, ease: E("arrive") }, 0);
      strike(tl, "[data-a=stamp]", 0.2);
    }, sealedDoc);
    return () => ctx.revert();
  }, [step]);

  const chosen = clients.find((c) => c.id === clientId);
  const draft = () => ({
    client: chosen
      ? { name: chosen.name, ...(chosen.vault ? { vault: chosen.vault } : { email: chosen.email ?? "" }) }
      : { name: newName, ...(newBy === "vault" ? { vault: newValue } : { email: newValue }) },
    currency,
    invoiceNumber: number,
    dueDays: Number(dueDays),
    lines: lines.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
    taxPercent: tax,
    poNumber: po,
    notes,
    earlyPay: earlyOn ? tiers.map((t) => ({ percent: t.percent, days: Number(t.days) })) : [],
  });

  // field-level checks; nothing is submitted while one is open
  const lineProblems = lines.map((l) => lineProblem(l));
  const dueProblem = dueDays.trim() === "" || whole(dueDays) ? null : "Whole days, zero or more.";
  const taxProblem = tax.trim() === "" || (scaled(tax) !== null && scaled(tax)! <= 100_000_000n) ? null : "A percentage from 0 to 100, like 7.5 (no minus sign).";
  const tierProblems = tiers.map((t) => ({
    percent: !earlyOn || t.percent.trim() === "" || (scaled(t.percent) !== null && scaled(t.percent)! > 0n && scaled(t.percent)! < 10_000_000n) ? undefined : "More than 0 and under 10.",
    days: !earlyOn || t.days.trim() === "" || (whole(t.days) && Number(t.days) >= 1) ? undefined : "Whole days, 1 or more.",
  }));
  const hasProblem =
    lineProblems.some((p) => p.quantity || p.unitPrice) || dueProblem !== null || taxProblem !== null || tierProblems.some((p) => p.percent || p.days);
  const subtotal = subtotalOf(lines);
  const taxScaled = scaled(tax === "" ? "0" : tax);
  const estimatedTax = subtotal !== null && taxScaled !== null ? (subtotal * taxScaled) / 100_000_000n : null; // 1e12 × 1e6 ÷ (100 × 1e6)

  const fail = (e: unknown) => setProblem(wasRejected(e) ? "You closed the wallet’s request, so nothing was signed." : e instanceof Error ? e.message : "Something went wrong.");

  async function review(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      setPrepared(await postJson<Prepared>("/api/vendor/invoice", { action: "prepare", draft: draft() }));
      setStep("review");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function signAndSend() {
    if (!prepared) return;
    setBusy(true);
    setProblem(null);
    setStep("signing");
    try {
      const signature = await signInvoice(signer, prepared, discover);
      const saved = await postJson<{ fingerprint: string; path: string }>("/api/vendor/invoice", { action: "send", document: prepared.document, signature });
      const sent_fp = saved.fingerprint;
      setSent(saved);
      setStep("sent");
      // the address bar names the invoice, so the result survives a reload and the link can be shared (QA NEW-6)
      try { window.history.replaceState(null, "", `/vendor/invoices/${sent_fp}`); } catch { /* the page still shows the result */ }
      try { sessionStorage.removeItem(DRAFT_KEY(handle)); } catch { /* nothing to clear */ }
    } catch (err) {
      fail(err);
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  const setLine = (id: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const setTier = (id: number, patch: Partial<Tier>) => setTiers((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  if ((step === "review" || step === "signing") && prepared)
    return (
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <InvoiceDoc document={prepared.document} fingerprint={prepared.fingerprint} handle={handle} />
        <section aria-labelledby="review" className="lg:pt-6">
          <PageTitle id="review">
            Check it, then sign.
          </PageTitle>
          <p className="mt-3 max-w-[52ch] text-graphite">
            This is the invoice you are sealing. Your wallet shows the same facts in its raw form, and it can’t translate them: the amount is a whole number in the token’s smallest unit ({prepared.document.total} {prepared.document.currency.symbol} appears as {rawAmount(prepared.document.total, prepared.document.currency.decimals)}), and the token appears as its address ({prepared.document.currency.symbol} is <span className="break-all font-mono">{prepared.document.currency.token}</span>). Signing seals it: a sealed invoice can’t be edited, and the fingerprint under it changes with any change to a word or a number.
          </p>
          {signer.kind === "none" ? (
            <p role="status" className="mt-6 rounded-doc border border-rule p-4 text-sm text-graphite">
              {signer.reason}
            </p>
          ) : (
            <p className="mt-4 text-sm text-graphite">
              Signing as <Address value={signer.address} full />
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button disabled={busy || signer.kind === "none"} onClick={signAndSend} className={primary}>
              {step === "signing" ? "Waiting for your wallet…" : "Sign and save"}
            </button>
            <button disabled={busy} onClick={() => setStep("edit")} className={ghost}>
              Back to editing
            </button>
          </div>
          {prepared.warnings?.length ? (
            <div className="mt-5 max-w-[52ch] space-y-2">
              {prepared.warnings.map((w) => (
                <p key={w} role="status" className="rounded-doc border border-warn/40 bg-warn-wash px-4 py-3 text-sm text-ink">{w}</p>
              ))}
            </div>
          ) : null}
          {problem ? (
            <InlineError className="mt-4 max-w-[52ch]">{problem}</InlineError>
          ) : null}
        </section>
      </div>
    );

  if (step === "sent" && prepared && sent) {
    const link = `${window.location.origin}${sent.path}`;
    return (
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div ref={sealedDoc}>
          <InvoiceDoc document={prepared.document} fingerprint={sent.fingerprint} handle={handle} sealed />
        </div>
        <section aria-labelledby="sent" className="lg:pt-6">
          <Eyebrow className="text-seal">Sealed and saved</Eyebrow>
          <PageTitle id="sent" className="mt-2">
            Invoice {prepared.document.invoiceNumber} is sealed.
          </PageTitle>
          <p className="mt-3 max-w-[52ch] text-graphite">Send {prepared.document.payer.name} this link. Anyone with it can open the invoice and check that it is genuine.</p>
          <p className="mt-5 break-all rounded-doc border border-rule bg-paper-raised px-4 py-3 font-mono text-sm">{link}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
              className={primary}
            >
              {copied ? "Copied" : "Copy the link"}
            </button>
            <Link href={`/vendor/invoices/${sent.fingerprint}`} className={ghost}>
              View the invoice
            </Link>
            <a href="/vendor/new" className={ghost}>
              Write another
            </a>
          </div>
          <p className="mt-6 max-w-[52ch] text-sm text-graphite">Nothing is emailed for you yet. If {prepared.document.payer.name} has a Symbolon Vault, it will also appear in their inbox.</p>
        </section>
      </div>
    );
  }

  return (
    <form onSubmit={review} className="max-w-4xl space-y-8">
      <div>
        <PageTitle>New invoice</PageTitle>
        <p className="mt-3 text-graphite">
          {fromFile ? "Read from your file. Check every field: the file is a draft, not an invoice." : "Fill it in, check the sealed text, then sign it with your wallet."}
          {!fromFile ? (
            <>
              {" "}
              <a href="/vendor/upload" className="underline decoration-rule underline-offset-4">
                Or upload one you already have
              </a>
              .
            </>
          ) : null}
        </p>
      </div>
      {fromFile ? <FromFileNotes f={fromFile} /> : null}
      {restored ? (
        <p role="status" className="rounded-doc border border-rule bg-paper-raised px-4 py-3 text-sm text-graphite">
          Your unsent draft was restored.{" "}
          <button
            type="button"
            className="underline decoration-rule underline-offset-4"
            onClick={() => {
              try { sessionStorage.removeItem(DRAFT_KEY(handle)); } catch { /* nothing to clear */ }
              window.location.reload();
            }}
          >
            Start over
          </button>
        </p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-1.5 text-sm font-medium text-ink">Client</legend>
        <select className={`${box} w-full`} value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW}>A new client…</option>
        </select>
        {clientId === NEW ? (
          <div className="space-y-3 rounded-doc border border-rule p-4">
            <label className={label}>
              Their name
              <input className={`${box} mt-1 w-full`} value={newName} onChange={(e) => setNewName(e.target.value)} required minLength={2} maxLength={200} />
            </label>
            <div role="radiogroup" aria-label="How to reach them" className="flex gap-4 text-sm">
              {(["vault", "email"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="radio" name="by" checked={newBy === k} onChange={() => setNewBy(k)} />
                  {k === "vault" ? "Their Vault address" : "Their email"}
                </label>
              ))}
            </div>
            <Field label={newBy === "vault" ? "Vault address" : "Email"}>
              {(a) => (
                <input
                  {...a}
                  className={`${box} w-full ${newBy === "vault" ? "font-mono" : ""}`}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder={newBy === "vault" ? "0x…" : "ap@company.example"}
                  required
                />
              )}
            </Field>
            <p className="text-sm text-graphite">A business on Symbolon can share its Vault address with you. Symbolon doesn’t list businesses.</p>
          </div>
        ) : chosen ? (
          <p className="break-all text-xs text-graphite">{chosen.vault ? <Address value={chosen.vault} full /> : chosen.email}</p>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          Invoice number
          <input className={`${box} mt-1 w-full`} value={number} onChange={(e) => setNumber(e.target.value)} required maxLength={100} />
        </label>
        <label className={label}>
          Due in (days)
          <input className={`${box} mt-1 w-full`} inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} required aria-invalid={dueProblem ? true : undefined} />
          {dueProblem ? <span role="alert" className="mt-1 block text-sm font-normal text-red">{dueProblem}</span> : null}
        </label>
        <label className={label}>
          Currency
          <select className={`${box} mt-1 w-full`} value={currency} onChange={(e) => setCurrency(e.target.value as "USDC" | "EURC")}>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </label>
      </div>
      <p className="-mt-4 text-sm text-graphite">Paid on Arc. {currency === "EURC" ? "EURC is paid on Arc only." : ""}</p>

      <fieldset className="space-y-3">
        <legend className="mb-1.5 text-sm font-medium text-ink">Lines</legend>
        {lines.map((l, i) => (
          <div key={l.id} className="grid gap-2 rounded-doc border border-rule p-3 sm:grid-cols-[1fr_5rem_7rem_auto]">
            <textarea className={`${box} sm:col-span-4`} rows={2} value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} placeholder={`Line ${i + 1}: what you did`} aria-label={`Line ${i + 1} description`} required />
            <label className="text-sm text-graphite sm:col-start-2 sm:row-start-2">
              Qty
              <input className={`${box} mt-1 w-full`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.id, { quantity: e.target.value })} required aria-invalid={lineProblems[i]?.quantity ? true : undefined} />
              {lineProblems[i]?.quantity ? <span role="alert" className="mt-1 block text-xs text-red">{lineProblems[i]!.quantity}</span> : null}
            </label>
            <label className="text-sm text-graphite sm:col-start-3 sm:row-start-2">
              Unit price
              <input className={`${box} mt-1 w-full`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(l.id, { unitPrice: e.target.value })} placeholder="0.00" required aria-invalid={lineProblems[i]?.unitPrice ? true : undefined} />
              {lineProblems[i]?.unitPrice ? <span role="alert" className="mt-1 block text-xs text-red">{lineProblems[i]!.unitPrice}</span> : /^\d*\.\d{3,}$/.test(l.unitPrice.trim()) ? <span className="mt-1 block text-xs text-graphite">More than cents. It is allowed, and the invoice will show every digit.</span> : null}
            </label>
            {lines.length > 1 ? (
              <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} className="min-h-9 self-end text-sm text-graphite underline decoration-rule underline-offset-4 sm:col-start-4 sm:row-start-2">
                Remove
              </button>
            ) : null}
          </div>
        ))}
        {lines.length < 100 ? (
          <button type="button" onClick={() => setLines((ls) => [...ls, { id: nextId.current++, description: "", quantity: "1", unitPrice: "" }])} className={ghost}>
            Add a line
          </button>
        ) : null}
      </fieldset>

      {subtotal !== null ? (
        <p className="-mt-4 text-sm text-graphite" aria-live="polite">
          Lines come to <span className="text-ink">{fromTwelve(subtotal)} {currency}</span>
          {estimatedTax !== null && taxScaled !== null && taxScaled > 0n ? <> · with tax about <span className="text-ink">{fromTwelve(subtotal + estimatedTax)} {currency}</span></> : null}
          . The review shows the exact sealed figures.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Tax (%), if any
          <input className={`${box} mt-1 w-full`} inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0" aria-invalid={taxProblem ? true : undefined} />
          {taxProblem ? <span role="alert" className="mt-1 block text-sm font-normal text-red">{taxProblem}</span> : null}
        </label>
        <label className={label}>
          PO number, if they gave you one
          <input className={`${box} mt-1 w-full`} value={po} onChange={(e) => setPo(e.target.value)} maxLength={100} />
        </label>
      </div>

      <fieldset className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={earlyOn} onChange={(e) => setEarlyOn(e.target.checked)} />
          Offer a discount for paying early
        </label>
        {earlyOn ? (
          <div className="space-y-2 rounded-doc border border-rule p-4">
            <p className="text-sm text-graphite">Each tier is a discount under 10% if paid within some days, and later tiers must be smaller. It only applies if the payer chooses it; you sign these terms.</p>
            {tiers.map((t, i) => (
              <div key={t.id} className="flex flex-wrap items-end gap-3">
                <label className="text-sm text-graphite">
                  Discount (%)
                  <input className={`${box} mt-1 block w-24`} inputMode="decimal" value={t.percent} onChange={(e) => setTier(t.id, { percent: e.target.value })} aria-label={`Tier ${i + 1} discount`} aria-invalid={tierProblems[i]?.percent ? true : undefined} />
                  {tierProblems[i]?.percent ? <span role="alert" className="mt-1 block max-w-[10rem] text-xs text-red">{tierProblems[i]!.percent}</span> : null}
                </label>
                <label className="text-sm text-graphite">
                  Paid within (days)
                  <input className={`${box} mt-1 block w-28`} inputMode="numeric" value={t.days} onChange={(e) => setTier(t.id, { days: e.target.value })} aria-label={`Tier ${i + 1} days`} aria-invalid={tierProblems[i]?.days ? true : undefined} />
                  {tierProblems[i]?.days ? <span role="alert" className="mt-1 block max-w-[10rem] text-xs text-red">{tierProblems[i]!.days}</span> : null}
                </label>
                {tiers.length > 1 ? (
                  <button type="button" onClick={() => setTiers((ts) => ts.filter((x) => x.id !== t.id))} className="min-h-9 pb-2 text-sm text-graphite underline decoration-rule underline-offset-4">
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            {tiers.length < 3 ? (
              <button type="button" onClick={() => setTiers((ts) => [...ts, { id: nextId.current++, percent: "0.5", days: "14" }])} className="min-h-9 text-sm underline decoration-rule underline-offset-4">
                Add a tier
              </button>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <label className={label}>
        Notes for the client, if any
        <textarea className={`${box} mt-1 w-full`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </label>

      {problem ? (
        <InlineError>{problem}</InlineError>
      ) : null}
      <button disabled={busy || hasProblem} className={primary}>
        {busy ? "Preparing…" : "Review the sealed text"}
      </button>
      {hasProblem ? <p className="-mt-4 text-sm text-graphite">Fix the fields marked above to continue.</p> : null}
    </form>
  );
}

/** What the file said that the form doesn't carry, as printed, to compare with the review. Text that tries to instruct the reader is shown as text and ignored. */
function FromFileNotes({ f }: { f: FromFile }) {
  return (
    <aside aria-label="What the file said" className="space-y-2 rounded-doc border border-rule bg-paper-raised p-4 text-sm">
      <p className="font-medium">What the file said</p>
      <ul className="space-y-1 text-graphite">
        <li>
          Total as printed: <span className="text-ink">{f.total || "—"} {f.currency}</span>. Symbolon works the total out from your lines; compare it in the review.
        </li>
        {f.taxes.length ? <li>Tax: {f.taxes.map((t) => `${t.label} ${t.amount}`).join(", ")}. Enter the tax as a percentage below.</li> : null}
        {f.discounts.length ? <li>Discounts: {f.discounts.map((t) => `${t.label} ${t.amount}`).join(", ")}. Discounts aren’t supported here yet: adjust the line prices instead.</li> : null}
        {f.currency && !/^(usd|usdc|us\$|\$)$/i.test(f.currency) ? <li>The file is in {f.currency}. Symbolon invoices are in USDC or EURC: choose one below.</li> : null}
        <li>The name, currency, chain and payout address on the invoice are yours, not the file’s.</li>
      </ul>
      {f.instructions.length || f.signals.length ? (
        <div role="alert" className="border-t border-rule pt-2 text-red">
          <p>This file contains text that tries to tell the reader what to do. It was not followed.</p>
          <ul className="mt-1 list-disc pl-5">
            {f.instructions.map((t, i) => (
              <li key={`i${i}`}>“{t}”</li>
            ))}
            {f.signals.map((t, i) => (
              <li key={`s${i}`}>“{t.excerpt}” (in {t.field})</li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
