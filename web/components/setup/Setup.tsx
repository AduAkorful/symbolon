"use client";

import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { formatUnits } from "viem";
import { openBusiness } from "@/app/actions";
import { useWalletProviders } from "@/components/wallet/useWalletProviders";
import { TxLink } from "@/components/TxLink";
import { postJson } from "@/lib/client/api";
import { D, E, registerMotion } from "@/lib/motion";
import { sendCall, wasRejected, type SignerPlan } from "./owner-signer";
import { showAmount } from "@/lib/format";
import { Address } from "@/components/Address";
import { buttonClass } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/Type";
import { controlClass } from "@/components/ui/Field";

/** What the chain says about the Steward of a Vault we know (plan 05h, H13): only "paused" (or "none", an older Vault with no Steward) lets the wizard on to Fund */
export type Standing = "paused" | "active" | "unknown" | "mismatch" | "none";

export interface SetupProps {
  business: { id: string; name: string; vault: string | null } | null;
  /** The Steward's standing on the chain when the page loaded; null while the business has no Vault */
  standing: Standing | null;
  templates: { key: string; name: string; blurb: string; lines: string[] }[];
  signer: SignerPlan;
  /** Explorer base (from the registry's chain), so links are built from it and never typed */
  explorer: string;
}

const steps = ["Business", "Policy", "Vault", "Fund"] as const;
const input = controlClass;
const primary = buttonClass();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (raw: string, decimals: number) => showAmount(formatUnits(BigInt(raw), decimals));
const message = (e: unknown) => (wasRejected(e) ? "You closed the wallet's request, so nothing was sent." : e instanceof Error ? e.message : "Something went wrong.");

type Balance = { ok: true; usdc: string; decimals: number; block: string } | { ok: false; error?: string; reason?: string };

/** Setting up a business (B1–B3): its name, a policy, the Vault on Arc, and funding it. Every fact about the Vault is read back from the chain. */
export function Setup(props: SetupProps) {
  const [business, setBusiness] = useState(props.business);
  const [standing, setStanding] = useState<Standing | null>(props.standing);
  const [i, setI] = useState(!props.business ? 0 : !props.business.vault ? 1 : props.standing === "paused" || props.standing === "none" ? 3 : 2);
  const [pauseTx, setPauseTx] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tpl, setTpl] = useState("standard");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [vaultTx, setVaultTx] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!panel.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const t = gsap.from(panel.current, { x: 24, opacity: 0, duration: D.base, ease: E("arrive") });
    return () => {
      t.revert();
    };
  }, [i]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      setProblem(message(e));
    } finally {
      setBusy(null);
    }
  };

  const discover = useWalletProviders();

  async function createBusiness(e: React.FormEvent) {
    e.preventDefault();
    await run("Creating…", async () => {
      const { id } = await postJson<{ id: string }>("/api/business", { name });
      setBusiness({ id, name: name.trim(), vault: null });
      setI(1);
    });
  }

  /** The chain may take a few seconds to show the transaction; ask again until it does */
  async function record(txHash: string) {
    for (let tries = 0; ; tries++) {
      try {
        const r = await postJson<{ vault: string }>(`/api/business/${business!.id}/vault`, { action: "record", txHash });
        setBusiness({ ...business!, vault: r.vault });
        setVaultTx(txHash);
        return;
      } catch (e) {
        if (tries < 20 && e instanceof Error && /isn't confirmed yet/.test(e.message)) {
          await wait(2000);
          continue;
        }
        throw e;
      }
    }
  }

  /** Asks the server what the chain says about the Steward, and keeps the answer on screen */
  async function readStanding(): Promise<Standing> {
    const r = await fetch(`/api/business/${business!.id}/vault`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { kind?: Standing; error?: string };
    if (!r.ok || !j.kind) throw new Error(j.error ?? "Can't confirm the Steward's state right now.");
    setStanding(j.kind);
    return j.kind;
  }

  /** Sends the owner's `pause()`, then looks at the chain until it shows the Vault paused; the button's state never decides */
  async function pause() {
    const call = await postJson<{ to: string; data: string }>(`/api/business/${business!.id}/vault`, { action: "pause" });
    setBusy("Waiting for your wallet…");
    const hash = await sendCall(props.signer, call, discover);
    setPauseTx(hash);
    setBusy("Confirming on Arc…");
    for (let n = 0; n < 20; n++) {
      try {
        if ((await readStanding()) === "paused") return;
      } catch {
        // a read that fails is asked again; it is never taken as paused
      }
      await wait(2000);
    }
    throw new Error("The pause isn't showing on Arc yet. Check again in a moment.");
  }

  /** Two signatures, in this order: create the Vault (with the Steward named), then pause it. If the second never happens, the next visit resumes at the pause. */
  async function createVault() {
    await run("Preparing…", async () => {
      const call = await postJson<{ to: string; data: string }>(`/api/business/${business!.id}/vault`, { action: "prepare", template: tpl });
      setBusy("Waiting for your wallet…");
      const hash = await sendCall(props.signer, call, discover);
      setVaultTx(hash);
      setBusy("Confirming on Arc…");
      await record(hash);
      setStanding("active");
      setBusy("Preparing the pause…");
      await pause();
    });
  }

  const chosen = props.templates.find((t) => t.key === tpl)!;

  return (
    <main className="mx-auto max-w-[980px] px-6 pb-24 pt-12">
      <ol className="relative flex justify-between" aria-label="Steps">
        <div className="absolute left-3 right-3 top-3 h-px bg-rule" />
        <div className="absolute left-3 top-3 h-0.5 bg-seal transition-[width] duration-[var(--dur-arrive)]" style={{ width: `calc(${(i / (steps.length - 1)) * 100}% - 1.5rem)` }} />
        {steps.map((s, k) => (
          <li key={s} className="relative z-10 flex flex-col items-center gap-2 text-sm" aria-current={k === i ? "step" : undefined}>
            <span className={`grid h-6 w-6 place-items-center rounded-full border-2 bg-paper text-xs ${k <= i ? "border-seal text-seal" : "border-rule text-graphite"}`}>{k < i ? "✓" : k + 1}</span>
            <span className={k === i ? "" : "text-graphite"}>{s}</span>
          </li>
        ))}
      </ol>

      <div ref={panel} key={i} className="mt-14">
        {i === 0 ? (
          <form onSubmit={createBusiness} className="max-w-xl">
            <PageTitle>Set up your business</PageTitle>
            <p className="mt-3 text-graphite">Your Steward pays sealed invoices from your Vault, within rules you set. You can start in shadow mode, where it only shows what it would do.</p>
            <label className="mt-8 block text-sm">
              Business name
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoFocus />
            </label>
            <button disabled={busy !== null} className={`mt-6 ${primary}`}>
              {busy ?? "Continue"}
            </button>
          </form>
        ) : null}

        {i === 1 ? (
          <div>
            <PageTitle>Start from a policy</PageTitle>
            <p className="mt-3 max-w-[60ch] text-graphite">
              Every rule is editable later. Tightening applies at once; loosening waits, so a stolen session can’t widen limits and pay out in the same minute. These are the rules your Vault is created with.
            </p>
            <div role="radiogroup" aria-label="Policy" className="mt-8 grid gap-4 md:grid-cols-3">
              {props.templates.map((t) => (
                <button key={t.key} role="radio" aria-checked={tpl === t.key} onClick={() => setTpl(t.key)} className={`rounded-doc border p-5 text-left ${tpl === t.key ? "border-ink bg-paper-raised" : "border-rule hover:border-ink/50"}`}>
                  <span className="font-display text-3xl">{t.name}</span>
                  <span className="mt-2 block text-sm text-graphite">{t.blurb}</span>
                  <ul className="mt-4 space-y-1 border-t border-rule pt-3 text-sm">
                    {t.lines.map((r) => (
                      <li key={r}>· {r}</li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
            <button onClick={() => setI(2)} className={`mt-8 ${primary}`}>
              Use {chosen.name}
            </button>
          </div>
        ) : null}

        {i === 2 ? (
          <div className="max-w-2xl">
            <PageTitle>Your Vault</PageTitle>
            <p className="mt-3 text-graphite">A contract on Arc that holds your funds and enforces your rules. It’s yours: only its owner can change the rules, upgrade it or withdraw. It starts with the {chosen.name} policy and a Steward wallet made for it. The Steward starts paused: it can’t pay anything until you resume it.</p>
            {props.signer.kind === "none" ? (
              <p role="status" className="mt-8 rounded-doc border border-rule p-4 text-sm text-graphite">
                {props.signer.reason}
              </p>
            ) : (
              <p className="mt-6 text-sm text-graphite">
                Owner: <Address value={props.signer.address} full />
              </p>
            )}
            {business?.vault ? (
              <div className="mt-8 border-t border-ink pt-4">
                <p className="text-sm text-graphite">Your Vault on Arc</p>
                <p className="text-xl"><Address value={business.vault} full /></p>
                <p className="mt-2 flex flex-wrap gap-x-4 text-sm">
                  {vaultTx ? <TxLink href={`${props.explorer}/tx/${vaultTx}`} label={`View the creation transaction ${vaultTx} on the Arc explorer`}>Created in transaction {vaultTx.slice(0, 10)}…{vaultTx.slice(-6)}</TxLink> : null}
                  <TxLink href={`${props.explorer}/address/${business.vault}`} label="View the Vault on the Arc explorer">View the Vault on the explorer</TxLink>
                </p>
                <StewardStep standing={standing} busy={busy} onPause={() => void run("Preparing the pause…", pause)} onCheck={() => void run("Checking Arc…", async () => void (await readStanding()))} pauseTx={pauseTx} explorer={props.explorer} />
                {standing === "paused" || standing === "none" ? (
                  <button onClick={() => setI(3)} className={`mt-6 ${primary}`}>
                    Continue
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <button disabled={busy !== null || props.signer.kind === "none"} onClick={createVault} className={`mt-8 ${primary}`}>
                  {busy ?? "Create the Vault (two signatures)"}
                </button>
                <details className="mt-8 text-sm">
                  <summary className="cursor-pointer text-graphite underline decoration-rule underline-offset-4">I already sent the transaction</summary>
                  <form
                    className="mt-3 flex max-w-xl flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run("Confirming on Arc…", () => record(pasted.trim()));
                    }}
                  >
                    <label className="min-w-[16rem] flex-1 text-xs text-graphite">
                      Transaction hash
                      <input className={`${input} font-mono`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="0x…" required />
                    </label>
                    <button disabled={busy !== null} className={buttonClass({ variant: "secondary" })}>
                      Check it
                    </button>
                  </form>
                </details>
              </>
            )}
          </div>
        ) : null}

        {i === 3 && business?.vault && (standing === "paused" || standing === "none") ? <Fund business={{ ...business, vault: business.vault }} props={props} standing={standing} run={run} busy={busy} discover={discover} /> : null}

        {problem ? (
          <p role="alert" className="mt-6 max-w-2xl text-sm text-red">
            {problem}
          </p>
        ) : null}
      </div>

      {i > 0 && i < 3 && !business?.vault ? (
        <button onClick={() => setI(i - 1)} className="mt-8 block text-sm text-graphite underline decoration-rule underline-offset-4">
          Back
        </button>
      ) : null}
    </main>
  );
}

/** Funding: the balance is only ever what the chain says. "Arrived" appears when the chain shows more than before, never when the form is sent. */
function Fund({ business, props, standing, run, busy, discover }: { business: { id: string; name: string; vault: string }; props: SetupProps; standing: Standing | null; run: (l: string, f: () => Promise<void>) => Promise<void>; busy: string | null; discover: () => Promise<import("@/components/signin/wallet").Eip1193[]> }) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [amount, setAmount] = useState("");
  const [sent, setSent] = useState<{ hash: string; from: bigint; arrived: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const loaded = useRef(false);

  const read = async (): Promise<Balance> => {
    const r = await fetch(`/api/business/${business.id}/fund`, { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as Balance;
    const b: Balance = r.ok ? j : { ok: false, reason: "Can't confirm the balance right now." };
    setBalance(b);
    return b;
  };

  useLayoutEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void read();
  });

  async function deposit(e: React.FormEvent) {
    e.preventDefault();
    await run("Preparing…", async () => {
      const before = balance?.ok ? BigInt(balance.usdc) : 0n;
      const call = await postJson<{ to: string; data: string }>(`/api/business/${business.id}/fund`, { amount });
      const hash = await sendCall(props.signer, call, discover);
      setSent({ hash, from: before, arrived: false });
      // Look at the chain until it shows more than before
      for (let n = 0; n < 15; n++) {
        await wait(2000);
        const b = await read();
        if (b.ok && BigInt(b.usdc) > before) {
          setSent({ hash, from: before, arrived: true });
          setAmount("");
          return;
        }
      }
    });
  }

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <div>
        <PageTitle>Fund it</PageTitle>
        <p className="mt-3 text-graphite">Send USDC on Arc into the Vault. Network fees are paid in USDC too, so the wallet needs a little beyond what you put in.</p>
        {props.signer.kind !== "none" ? (
          <form onSubmit={deposit} className="mt-8">
            <label className="block text-sm">
              Amount (USDC), from your wallet
              <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="100.00" required />
            </label>
            <button disabled={busy !== null || !amount} className={`mt-4 ${primary}`}>
              {busy ?? "Deposit"}
            </button>
          </form>
        ) : (
          <p role="status" className="mt-8 rounded-doc border border-rule p-4 text-sm text-graphite">
            {props.signer.reason}
          </p>
        )}
        <div className="mt-8 border-t border-rule pt-4 text-sm">
          <p className="text-graphite">Or send USDC to the Vault’s address on Arc from anywhere that can:</p>
          <p className="mt-2"><Address value={business.vault} full /></p>
          <div className="mt-2 flex flex-wrap gap-x-4">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(business.vault).then(() => setCopied(true));
              }}
              className="text-xs underline decoration-rule underline-offset-4"
            >
              {copied ? "Copied" : "Copy address"}
            </button>
            <TxLink href={`${props.explorer}/address/${business.vault}`} label="View the Vault on the Arc explorer">View on the explorer</TxLink>
          </div>
          <p className="mt-4 text-graphite">Funding from other chains isn’t available in this version.</p>
        </div>
      </div>
      <div className="lg:pt-24">
        <p className="text-sm text-graphite">{business.name}’s Vault holds</p>
        <p className="font-display text-7xl leading-none" aria-live="polite">
          {balance?.ok ? `$${fmt(balance.usdc, balance.decimals)}` : balance ? "—" : "…"}
        </p>
        <p className="mt-2 text-xs text-graphite">
          {balance?.ok ? `Read from Arc at block ${balance.block}.` : balance ? "Can’t confirm the balance right now." : "Reading the balance from Arc…"}
          {balance && !balance.ok ? (
            <button onClick={() => void read()} className="ml-2 underline decoration-rule underline-offset-4">
              Try again
            </button>
          ) : null}
        </p>
        {sent ? (
          <div className="mt-6 space-y-2 text-sm">
            <p className={sent.arrived ? "text-seal" : "text-graphite"}>{sent.arrived ? "✓ Arrived on Arc" : "Sent. Waiting for the chain to show it…"}</p>
            <TxLink href={`${props.explorer}/tx/${sent.hash}`} label={`View the deposit transaction ${sent.hash} on the Arc explorer`}>Deposit transaction {sent.hash.slice(0, 10)}…{sent.hash.slice(-6)}</TxLink>
          </div>
        ) : null}
        <form action={openBusiness} className="mt-10">
          <input type="hidden" name="id" value={business.id} />
          <button className={primary}>Open {business.name}</button>
        </form>
        <p className="mt-3 max-w-[44ch] text-sm text-graphite">
          {standing === "paused"
            ? "Your Steward is paused, so nothing can be paid from this Vault yet. Resume it from the business home when you’re ready; it stays in shadow mode, recording what it would do, until you change that."
            : "No Steward is assigned to this Vault."}
        </p>
      </div>
    </div>
  );
}

/** The second half of the Vault step: the Steward is set, and stays unable to pay until the chain shows the Vault paused (H13) */
function StewardStep({ standing, busy, onPause, onCheck, pauseTx, explorer }: { standing: Standing | null; busy: string | null; onPause: () => void; onCheck: () => void; pauseTx: string | null; explorer: string }) {
  if (standing === "paused") {
    return (
      <p role="status" className="mt-6 text-sm text-seal">
        ✓ Paused on Arc. The Steward can’t pay anything until you resume it.{" "}
        {pauseTx ? <TxLink href={`${explorer}/tx/${pauseTx}`} label={`View the pause transaction ${pauseTx} on the Arc explorer`}>Pause transaction {pauseTx.slice(0, 10)}…{pauseTx.slice(-6)}</TxLink> : null}
      </p>
    );
  }
  if (standing === "none") {
    return <p className="mt-6 text-sm text-graphite">This Vault was made without a Steward, so there is nothing to pause.</p>;
  }
  if (standing === "mismatch") {
    return (
      <p role="alert" className="mt-6 max-w-[60ch] text-sm text-red">
        The Steward this Vault reports isn’t the wallet we set up for this business. Don’t fund it. Check the Vault on the explorer.
      </p>
    );
  }
  return (
    <div className="mt-6 max-w-[60ch] text-sm">
      <p className={standing === "unknown" ? "text-red" : "text-graphite"}>
        {standing === "unknown"
          ? "Can’t confirm the Steward’s state on Arc right now."
          : "The Steward is set on your Vault and isn’t paused yet. Pause it now, before you put money in: payments stop until you resume."}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button disabled={busy !== null} onClick={onPause} className={primary}>
          {busy ?? "Pause the Steward (one signature)"}
        </button>
        <button disabled={busy !== null} onClick={onCheck} className={buttonClass({ variant: "secondary" })}>
          Check Arc again
        </button>
      </div>
    </div>
  );
}
