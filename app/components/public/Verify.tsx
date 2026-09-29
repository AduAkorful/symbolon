"use client";

import { useState } from "react";
import { createArcClient, getDeployment } from "@symbolon/chain";
import { showAmount, showDate } from "@/lib/format";
import { runCheck, type CheckResult } from "@/lib/verify-check";

const box = "rounded-doc border border-rule bg-paper px-3 py-2 text-[15px] focus:border-ink focus:outline-none";
const LINK = /\/invoice\/(0x[0-9a-f]{64})\/?$/i;

/**
 * The public verify page (P2, plan 05i V11). The check runs here, in the visitor's browser, against Arc's public RPC and the ledger
 * in the registry: the file is never sent to Symbolon. Its answers: genuine, modified, sealed for another ledger, or not an invoice.
 */
export function Verify({ chainId, explorer }: { chainId: number; explorer: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function check(content: string) {
    setBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const deployment = getDeployment(chainId);
      setResult(await runCheck(createArcClient(chainId), deployment, content));
    } catch {
      setProblem("The check couldn’t run. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  /** A file dropped or chosen: read it here and check it. The bytes stay in this page. */
  async function fromFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setResult({ kind: "unsealed", reason: "That file is too large to be an invoice." });
      return;
    }
    const content = await file.text();
    setText(content);
    await check(content);
  }

  /** A link to an invoice on this site: fetch its sealed file from here, then check the file itself, not the page */
  async function fromLink(value: string) {
    const m = LINK.exec(value.trim().split(/[?#]/)[0]!);
    let url: URL | null = null;
    try {
      url = new URL(value.trim());
    } catch {
      url = null;
    }
    if (!m || !url || url.origin !== window.location.origin) {
      setResult({ kind: "unsealed", reason: "That isn’t a link to an invoice on this site. Paste the contents of a .symbolon file instead, or drop the file above." });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/invoice/${m[1]!.toLowerCase()}/file`, { cache: "no-store" });
      if (!r.ok) {
        setResult({ kind: "unsealed", reason: "That link doesn’t lead to a valid invoice." });
        setBusy(false);
        return;
      }
      const content = await r.text();
      setText(content);
      await check(content);
    } catch {
      setProblem("Can’t reach the link right now.");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section aria-label="Check an invoice" className="space-y-5">
        <label className="grid cursor-pointer place-items-center rounded-doc border-2 border-dashed border-rule px-6 py-14 text-center hover:border-ink/60" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void fromFile(e.dataTransfer.files[0]); }}>
          <span>Drop an invoice file here, or choose one</span>
          <span className="mt-1 text-sm text-graphite">A .symbolon file. A PDF can’t be checked yet.</span>
          <input type="file" accept=".symbolon,application/json,.json" className="sr-only" onChange={(e) => void fromFile(e.target.files?.[0])} />
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\s*\{/.test(text)) void check(text);
            else void fromLink(text);
          }}
          className="space-y-3"
        >
          <label className="block text-sm text-graphite" htmlFor="paste">
            Or paste an invoice link from this site, or the contents of the file
          </label>
          <textarea id="paste" className={`${box} w-full font-mono text-xs`} rows={5} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <button disabled={busy || !text.trim()} className="rounded-doc bg-ink px-5 py-2.5 font-medium text-paper disabled:opacity-40">
            {busy ? "Checking…" : "Check it"}
          </button>
        </form>
        <p className="text-xs text-graphite">The check runs in this page against Arc’s public ledger. The file isn’t uploaded to Symbolon.</p>
      </section>

      <section aria-live="polite" aria-label="Result">
        {problem ? <p role="alert" className="text-red">{problem}</p> : null}
        {result ? <Result r={result} explorer={explorer} /> : busy ? <p className="text-graphite">Checking…</p> : <p className="text-graphite">The answer appears here.</p>}
      </section>
    </div>
  );
}

const explain: Record<string, string> = {
  signature: "The signature doesn’t match the invoice as written. It was changed after it was signed, or it wasn’t signed by the Seal it names.",
  chain_mismatch: "It was sealed for a different network or ledger than Symbolon’s on Arc, so it can’t be paid here.",
};

function Result({ r, explorer }: { r: CheckResult; explorer: string }) {
  if (r.kind === "unsealed")
    return (
      <div data-a="verdict">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-graphite">Not a Symbolon invoice</p>
        <h2 className="mt-2 font-display text-4xl leading-none">Nothing to check.</h2>
        <p className="mt-3 text-graphite">{r.reason}</p>
      </div>
    );

  if (r.kind === "modified" || r.kind === "elsewhere")
    return (
      <div data-a="verdict">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-red">{r.kind === "modified" ? "Not genuine" : "Sealed for another ledger"}</p>
        <h2 className="mt-2 font-display text-4xl leading-none">{r.kind === "modified" ? "This invoice has been changed, or isn’t what it claims." : "This invoice can’t be paid on Symbolon."}</h2>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
          {[...new Set(r.issues.map((i) => explain[i.code] ?? i.message))].slice(0, 5).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="mt-4 text-graphite">Don’t pay from it. Ask the sender for a new link.</p>
      </div>
    );

  const v = r.check.verification;
  const d = v.document!;
  const st = r.check.status;
  return (
    <div data-a="verdict">
      <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">Genuine</p>
      <h2 className="mt-2 font-display text-4xl leading-none">Sealed by its sender, and unchanged.</h2>
      <dl className="mt-6 divide-y divide-rule-soft border-y border-rule text-sm">
        {[
          ["Seal", v.seal!],
          ["Invoice", `No. ${d.invoiceNumber} · ${d.vendor.name} to ${d.payer.name}`],
          ["Amount", `${showAmount(d.total)} ${d.currency.symbol}, due ${showDate(d.dueDate)}`],
          ["Pays out to", d.payout.address],
          ["Fingerprint", v.fingerprint!],
        ].map(([k, val]) => (
          <div key={k} className="grid grid-cols-[7rem_1fr] gap-3 py-2.5">
            <dt className="text-graphite">{k}</dt>
            <dd className="break-all">{val}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-sm">
        {!r.ledger.ok || !st ? (
          <span className="text-red">{r.ledger.ok ? "Can’t read the ledger on Arc right now." : r.ledger.reason} The signature was checked; payment status isn’t shown.</span>
        ) : st.cancelled ? (
          "Cancelled by the sender on Arc’s ledger."
        ) : st.paid ? (
          <span className="text-seal">Paid in full, according to Arc’s ledger.</span>
        ) : st.credited > 0n ? (
          <span className="text-seal">Partly paid, according to Arc’s ledger.</span>
        ) : (
          "Not paid, according to Arc’s ledger."
        )}
      </p>
      {r.check.settlements.length ? (
        <ul className="mt-3 space-y-1 text-xs">
          {r.check.settlements.map((s) => (
            <li key={s.txHash}>
              Paid on {showDate(Number(s.timestamp))} by <span className="font-mono">{s.payer}</span> ·{" "}
              <a href={`${explorer}/tx/${s.txHash}`} target="_blank" rel="noreferrer" className="font-mono underline decoration-rule underline-offset-4">
                {s.txHash.slice(0, 10)}…{s.txHash.slice(-6)} ↗
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
