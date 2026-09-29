"use client";

import { useState, type ReactNode } from "react";
import { Act } from "@/components/Act";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";

/**
 * Verifying a vendor (spec §11.1, Flow 3b). Verification answers one question: is this Seal the company we mean to
 * pay? Each method says what it proves. A code or a two-match records check gives Verified; a test payment only gives
 * Address confirmed, because an impostor holds the address too.
 */
type Step = "choose" | "code" | "records" | "test" | "testWait" | "done" | "adding" | "added";
type Result = { method: "code" | "records"; evidence: string; at: string };

const THRESHOLD = "$10,000.00";
const CAP = "$4,000.00 a month";
// What Kestrel's account shows them under Clients → Verification (vendor app)
const THEIR_CODE = "582104";

const records: { check: string; against: string; result: string; ok: boolean | null; counts: boolean }[] = [
  { check: "Legal name", against: "“Kestrel Labs Ltd” against your accounting vendors (Xero)", result: "Match: added 3 Mar", ok: true, counts: true },
  { check: "Domain", against: "kestrel.dev, proved by them, against contacts your team already has", result: "Match: mira@kestrel.dev, in Ama’s contacts", ok: true, counts: true },
  { check: "Tax ID", against: "Not given on their profile", result: "Nothing to compare", ok: null, counts: true },
  { check: "Lookalikes", against: "kestrel.dev against your vendors and domains", result: "None close", ok: true, counts: false },
];

function Method({ title, body, tag, tone, onClick, done }: { title: string; body: ReactNode; tag: string; tone: "seal" | "muted"; onClick: () => void; done?: boolean }) {
  return (
    <button onClick={onClick} disabled={done} className="block w-full rounded-doc border border-rule px-4 py-3 text-left transition-colors duration-[var(--dur-quick)] hover:border-ink disabled:opacity-60 disabled:hover:border-rule">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{title}</span>
        <span className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] ${tone === "seal" ? "text-seal" : "text-graphite"}`}>{done ? "✓ Done" : tag}</span>
      </span>
      <span className="mt-0.5 block text-sm text-graphite">{body}</span>
    </button>
  );
}

const input = "mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2 focus:border-ink focus:outline-none";
const primary = "rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-40";
const back = "rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink";

export function VerifyVendor({ onTrust }: { onTrust: (t: "new" | "address" | "verified") => void }) {
  const [step, setStep] = useState<Step>("choose");
  const [addressOk, setAddressOk] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [who, setWho] = useState("");
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const [checked, setChecked] = useState(false);

  const verified = (r: Result) => {
    setResult(r);
    setStep("done");
    onTrust("verified");
  };
  const independent = records.filter((r) => r.counts && r.ok).length;

  if (step === "choose")
    return (
      <>
        <p className="font-medium">Confirm this is really Kestrel Labs</p>
        <p className="mt-2 border-l-2 border-red pl-3 text-sm">
          <span className="font-medium">Use a contact you already had.</span> Not the phone number or email in this invoice, the email it came from, or Kestrel’s Seal
          profile. Anyone can put anything there.
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {[
            ["Seal", "@kestrel-labs, first seen 25 Sep"],
            ["Domain", "kestrel.dev, proved by them"],
            ["Paid at", "0x8e41…c07d, never paid by Acme"],
            ["Screening", "Medium, weekly"],
            ["Logo", "They set one. It stays hidden until you verify them"],
          ].map(([k, val]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-16 shrink-0 text-graphite">{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
        {addressOk ? (
          <p role="status" className="mt-4 text-sm text-seal">
            ✓ The address answered a test payment. That doesn’t say who they are; confirm that next.
          </p>
        ) : null}
        <div className="mt-4 space-y-2">
          <Method
            title="Call or message someone you already know there"
            body="They read you a code from their Symbolon account. It confirms the person you know controls this Seal."
            tag="Verifies"
            tone="seal"
            onClick={() => setStep("code")}
          />
          <Method
            title="Check your records"
            body="Compare their legal name, domain and tax ID with records you already hold. Needs two independent matches."
            tag="Verifies"
            tone="seal"
            onClick={() => setStep("records")}
          />
          <Method
            title="Send a test payment"
            body="$0.37 to their Seal’s address; they confirm the exact amount. It shows the address is live and theirs to use, not who they are."
            tag="Address only"
            tone="muted"
            done={addressOk}
            onClick={() => setStep("test")}
          />
        </div>
        <p className="mt-4 text-xs text-graphite">
          Kestrel’s cap is {CAP}, under Acme’s {THRESHOLD} owner threshold, so one person can confirm. Above it, an approver or the owner other than whoever raised the request confirms
          too. Next time, add vendors first (Add a vendor) and skip this step.
        </p>
      </>
    );

  if (step === "code")
    return (
      <>
        <p className="font-medium">Confirm by code</p>
        <p className="mt-2 text-sm text-graphite">
          Call or message someone at Kestrel you knew before this invoice, on a number or thread you already had. Ask them to open Symbolon, go to Clients, then Verification, and
          read you the code shown for Acme.
        </p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.replace(/\D/g, "") === THEIR_CODE) {
              setWrong(false);
              verified({ method: "code", evidence: who.trim(), at: "Today, 14:32" });
            } else setWrong(true);
          }}
        >
          <label className="block text-sm">
            Who did you reach, and how?
            <input required value={who} onChange={(e) => setWho(e.target.value)} placeholder="Mira Kestrel, on our shared Slack channel" className={input} />
          </label>
          <label className="block text-sm">
            The code they read you
            <input
              required
              inputMode="numeric"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setWrong(false);
              }}
              placeholder="000 000"
              aria-invalid={wrong}
              className={`${input} font-mono text-xl tracking-[0.2em]`}
            />
          </label>
          <p className="text-xs text-graphite">
            Demo: the code on Kestrel’s screen is <span className="font-mono">582 104</span>.
          </p>
          {wrong ? (
            <p role="alert" className="text-sm text-red">
              That doesn’t match. Ask them to read it again. If it still doesn’t, the person you reached may not control this Seal; don’t verify it.
            </p>
          ) : null}
          <div className="flex gap-3">
            <button className={primary}>Confirm</button>
            <button type="button" onClick={() => setStep("choose")} className={back}>
              Back
            </button>
          </div>
        </form>
      </>
    );

  if (step === "records")
    return (
      <>
        <p className="font-medium">Check your records</p>
        <p className="mt-2 text-sm text-graphite">Only matches from sources independent of the invoice count. Two are needed to verify; with one, you’d also need a code.</p>
        <ul className="mt-4 border-t border-ink text-sm">
          {records.map((r) => (
            <li key={r.check} className="grid grid-cols-[5.5rem_1fr] gap-x-3 border-b border-rule py-2.5">
              <span className="text-graphite">{r.check}</span>
              <span>
                <span className="block text-graphite">{r.against}</span>
                <span className={r.ok ? "text-seal" : "text-graphite"}>
                  {r.ok ? "✓ " : "– "}
                  {r.result}
                  {!r.counts ? " (a safety check, not counted)" : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className={`mt-3 text-sm ${independent >= 2 ? "text-seal" : "text-red"}`}>
          {independent} independent matches. {independent >= 2 ? "That’s enough to verify." : "Not enough: use a code as well."}
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1" />
          <span>I’ve looked at these, and this is the Kestrel Labs Acme means to pay.</span>
        </label>
        <div className="mt-4 flex gap-3">
          <button
            disabled={!checked || independent < 2}
            onClick={() => verified({ method: "records", evidence: "Legal name (Xero, added 3 Mar) and domain (Ama’s contacts)", at: "Today, 14:32" })}
            className={primary}
          >
            Confirm
          </button>
          <button onClick={() => setStep("choose")} className={back}>
            Back
          </button>
        </div>
      </>
    );

  if (step === "test")
    return (
      <>
        <p className="font-medium">Send a test payment</p>
        <p className="mt-2 text-sm text-graphite">
          $0.37 goes from Acme’s Vault to 0x8e41…c07d on Arc. It’s a manual payment: you sign it and it’s recorded as a decision; no invoice is marked paid. Kestrel confirms the
          exact amount from inside their account.
        </p>
        <p className="mt-2 text-sm">
          This shows the address is live and theirs to use. It <span className="font-medium">doesn’t show who they are</span>, so it can’t verify Kestrel on its own.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Act
            className={primary}
            tx={tx.testPayment}
            confirm={{ title: "Send a $0.37 test payment", body: "A manual payment from Acme’s Vault to 0x8e41…c07d, signed by you and recorded as a decision.", action: "Sign and send" }}
            done="Sent $0.37."
            onDone={() => setStep("testWait")}
          >
            Sign and send $0.37
          </Act>
          <button onClick={() => setStep("choose")} className={back}>
            Back
          </button>
        </div>
      </>
    );

  if (step === "testWait")
    return (
      <>
        <p className="font-medium">Waiting for Kestrel to confirm the amount</p>
        <p className="mt-2 text-sm">
          $0.37 sent to 0x8e41…c07d. <TxLink hash={tx.testPayment}>{tx.testPayment}</TxLink>
        </p>
        <p className="mt-2 text-sm text-graphite">They confirm the exact amount from their own Symbolon account. Only whoever controls that account can.</p>
        <button
          onClick={() => {
            setAddressOk(true);
            onTrust("address");
            setStep("choose");
          }}
          className={`mt-4 ${primary}`}
        >
          They’ve confirmed $0.37 (demo)
        </button>
      </>
    );

  if (step === "done" && result)
    return (
      <>
        <p className="text-seal">✓ Kestrel Labs is verified for Acme</p>
        <dl className="mt-3 text-sm">
          {[
            ["How", result.method === "code" ? "A code over a channel you already trusted" : "A records match, two independent"],
            ["Evidence", result.evidence],
            ["Confirmed by", `You, ${result.at.toLowerCase()}`],
            ["Address", addressOk ? "Confirmed by a test payment" : "Not tested (optional)"],
          ].map(([k, val]) => (
            <div key={k} className="grid grid-cols-[7rem_1fr] gap-3 border-b border-rule-soft py-2">
              <dt className="text-graphite">{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-graphite">Recorded as a decision, and it stays on this vendor’s page. It doesn’t skip the other guards: a 24-hour wait for new payees, and a person approves the first invoices.</p>
        <p className="mt-4 text-sm">Add them as a payee to pay their invoices. Adding a payee is recorded in the Vault and signed by you.</p>
        <button onClick={() => setStep("adding")} className={`mt-3 ${primary}`}>
          Add as a payee
        </button>
      </>
    );

  if (step === "adding")
    return (
      <>
        <p className="font-medium">You’re signing: add Kestrel Labs as a payee</p>
        <p className="mt-2 text-sm">Paid at 0x8e41…c07d on Arc · Engineering budget · $4,000.00 a month · invoice only.</p>
        <div className="mt-4 flex gap-3">
          <button onClick={() => setStep("added")} className={primary}>
            Sign
          </button>
          <button onClick={() => setStep("done")} className={back}>
            Back
          </button>
        </div>
      </>
    );

  return (
    <p role="status" className="text-sm">
      Added. New payees can be paid after a 24-hour wait, so KL-301 can go out from tomorrow, 14:30, and still well before its 22 Oct due date. <TxLink hash={tx.payeeAdd}>Added in {tx.payeeAdd}</TxLink>
    </p>
  );
}
