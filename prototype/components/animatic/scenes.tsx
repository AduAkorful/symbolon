"use client";

import type { ReactNode } from "react";
import gsap from "gsap";
import { Half } from "@/components/Chirograph";
import { SealStamp } from "@/components/Marks";
import { Scatter } from "@/components/Scatter";
import { fraud, invoice, retainer, vendor } from "@/lib/demo";
import { D, E, S, blurIn, draw, resolveText, roll, strike, writeIn } from "@/lib/motion";

/**
 * Animatic scenes, one per storyboard beat (lib/storyboards.ts), on a 1280×800 stage. `render` is the finished
 * state; `build` adds motion *from* earlier states at `at`. Targets are found by data-a inside the scene.
 */
export interface Scene {
  render: () => ReactNode;
  build: (tl: gsap.core.Timeline, q: (sel: string) => Element[], at: string) => void;
}

const a = (q: (s: string) => Element[], name: string) => q(`[data-a="${name}"]`);
const one = (q: (s: string) => Element[], name: string) => a(q, name)[0] ?? null;

// ——— Shared pieces ———

function Tick({ cross = false, className = "" }: { cross?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-5 w-5 ${cross ? "text-red" : "text-seal"} ${className}`} aria-hidden>
      <path
        data-a={cross ? "cross" : "tick"}
        pathLength={1}
        strokeDasharray="1"
        d={cross ? "M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" : "M2.5 8.5 L6.5 12 L13.5 3.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

const inboxItems = [
  { who: "Northwind Agency", what: "Invoice 2291", amount: "9,000.00", tag: "Verified", tone: "seal" },
  { who: "Forge Supply", what: "Invoice F-778", amount: "14,000.00", tag: "Held", tone: "red" },
  { who: "Cloudline", what: "Hosting, October", amount: "1,240.00", tag: "Verified", tone: "seal" },
  { who: "Halden Freight", what: "Invoice 88-12", amount: "4,100.00", tag: "Verified", tone: "seal" },
  { who: "Kestrel Labs", what: "Invoice KL-301", amount: "2,600.00", tag: "Verified", tone: "seal" },
];

function Inbox({ top }: { top: { who: string; what: string; amount: string; tag: string; tone: string } }) {
  const row = (r: typeof top, name: string) => (
    <li
      key={r.who + r.what}
      data-a={name}
      className={`grid grid-cols-[1fr_1fr_auto_7rem] items-center gap-6 border-b border-rule px-2 py-4 text-lg ${name === "new" ? "bg-paper-raised" : ""}`}
    >
      <span className="font-medium">{r.who}</span>
      <span className="text-graphite">{r.what}</span>
      <span className="text-right">{r.amount}</span>
      <span className={`text-right font-mono text-xs uppercase tracking-[0.14em] ${r.tone === "red" ? "text-red" : "text-seal"}`}>{r.tag}</span>
    </li>
  );
  return (
    <div className="px-24 pt-20">
      <h2 className="font-display text-5xl">Inbox</h2>
      <ul className="mt-8 border-t border-ink">
        {row(top, "new")}
        {inboxItems.map((r) => row(r, "rest"))}
      </ul>
    </div>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto mt-10 h-[700px] w-[340px] rounded-[44px] border-2 border-ink bg-paper-raised p-4 shadow-[0_30px_60px_rgba(21,33,28,0.15)]">
      <div className="mx-auto h-5 w-24 rounded-full bg-ink/90" />
      <div className="relative h-[calc(100%-1.25rem)] overflow-hidden px-4 pt-6">{children}</div>
    </div>
  );
}

function StudioAnaHalf({ tone = "var(--rule)", fp = invoice.fingerprint, title = vendor.name, rows = invoice.lines.map((l) => [l.description, l.amount.replace(".000000", ".00")] as [string, string]) }: { tone?: string; fp?: string; title?: string; rows?: [string, string][] }) {
  return (
    <Half side="vendor" fingerprint={fp} className="h-[520px] w-[440px] bg-paper-raised" tone={tone}>
      <div className="px-9 py-9 pr-16">
        <p className="font-display text-4xl">{title}</p>
        <p className="mt-1 font-mono text-sm text-graphite">{vendor.handle}</p>
        <div className="mt-10 border-t border-rule">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-rule-soft py-3.5 text-base">
              <span className="text-graphite">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </Half>
  );
}

function AcmeHalf({ tone = "var(--rule)", fp = invoice.fingerprint, ghost = false, rows = [["PO", "PO-0031"], ["Kind", "Retainer, monthly"], ["Delivered", "30 Sep"], ["Budget", "Design"]] as [string, string][] }: { tone?: string; fp?: string; ghost?: boolean; rows?: [string, string][] }) {
  return (
    <Half side="payer" fingerprint={fp} className={`h-[520px] w-[440px] ${ghost ? "bg-paper/60" : "bg-paper-raised"}`} tone={tone}>
      <div className="px-9 py-9 pl-16">
        <p className="font-display text-4xl">Acme</p>
        <p className="mt-1 text-sm text-graphite">Order and delivery</p>
        <div className="mt-10 border-t border-rule">
          {rows.map(([k, v]) => (
            <div key={k} data-a="acme-row" className="flex justify-between gap-4 border-b border-rule-soft py-3.5 text-base">
              <span className="text-graphite">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </Half>
  );
}

const retainerRows: [string, string][] = [
  ["No.", retainer.number],
  ["For", "Retainer, October"],
  ["PO", retainer.po],
  ["Total", "2,000.00"],
];

// ——— Flow scenes ———

const fraudScenes: Scene[] = [
  {
    render: () => <Inbox top={{ who: "Studio Ana?", what: "Invoice #0150", amount: fraud.claimedAmount, tag: "Unsigned", tone: "red" }} />,
    build: (tl, q, at) => {
      tl.from(a(q, "new"), { opacity: 0, y: -24, duration: D.arrive, ease: E("arrive") }, at);
      tl.from(a(q, "rest"), { y: -61, duration: D.arrive, ease: E("arrive") }, at);
    },
  },
  {
    render: () => (
      <div className="flex gap-16 px-24 pt-20">
        <div className="w-[520px] rounded-doc border border-red/60 bg-paper-raised p-10">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-red">Unsigned PDF, from {fraud.from}</p>
          <p data-a="field" className="mt-4 font-display text-4xl">Studio Ana</p>
          {[
            ["No.", "0150"],
            ["Amount", fraud.claimedAmount],
            ["Pay to", fraud.newAddress],
          ].map(([k, v]) => (
            <div key={k} data-a="field" className="flex justify-between border-b border-rule-soft py-4 text-lg">
              <span className="text-graphite">{k}</span>
              <span className={k === "Pay to" ? "font-mono text-red" : ""}>{v}</span>
            </div>
          ))}
          <p data-a="field" className="relative mt-6 inline-block text-lg">
            Pay today to avoid late fees
            <span data-a="underline" className="absolute -bottom-1 left-0 h-0.5 w-full origin-left bg-red" />
          </p>
        </div>
        <ul className="mt-16 space-y-5 text-2xl text-red">
          {["No Seal", "A new address", "A look-alike domain", "Pressure to pay now"].map((f) => (
            <li key={f} data-a="flag" className="flex items-center gap-3">
              <Tick cross />
              {f}
            </li>
          ))}
        </ul>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "field"), { opacity: 0, x: -8, duration: D.base, ease: E("settle"), stagger: S.field }, at);
      tl.from(a(q, "underline"), { scaleX: 0, duration: D.base, ease: E("settle") }, `${at}+=0.35`);
      tl.from(a(q, "flag"), { opacity: 0, duration: D.quick, stagger: S.row }, `${at}+=0.5`);
      draw(tl, a(q, "cross"), `${at}+=0.5`, S.row);
    },
  },
  {
    render: () => (
      <div className="flex justify-center gap-[34px] pt-24">
        <div data-a="fake">
          <StudioAnaHalf tone="var(--red)" fp={fraud.fingerprint} title="Studio Ana?" rows={[["No.", "0150"], ["Pay to", fraud.newAddress], ["Seal", "none"]]} />
        </div>
        <AcmeHalf ghost tone="var(--graphite)" fp={retainer.fingerprint} rows={[["Pays only to", vendor.payout], ["Changes", "Sealed, then 72 h"]]} />
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "fake"), { x: -260, duration: D.deliberate, ease: E("arrive") }, at);
    },
  },
  {
    render: () => (
      <div className="flex justify-center gap-[34px] pt-24">
        <StudioAnaHalf tone="var(--red)" fp={fraud.fingerprint} title="Studio Ana?" rows={[["No.", "0150"], ["Pay to", fraud.newAddress], ["Seal", "none"]]} />
        <div className="absolute left-[calc(50%-17px)] top-24 h-[520px] w-[120px]">
          <Scatter text={fraud.fingerprint.replace(/^0x/, "").slice(0, 16).toUpperCase()} />
        </div>
        <AcmeHalf ghost tone="var(--graphite)" fp={retainer.fingerprint} rows={[["Pays only to", vendor.payout], ["Changes", "Sealed, then 72 h"]]} />
      </div>
    ),
    build: (tl, q, at) => {
      // Letters loosen from the bottom up and drift out of the cut
      tl.from(q('[data-frag="letter"]'), { x: 0, y: 0, rotation: 0, opacity: 0.8, duration: D.cinematic, ease: E("settle"), stagger: { each: S.letter, from: "end" } }, at);
      tl.from(q('[data-frag="dust"]'), { x: -30, opacity: 0, duration: D.cinematic, ease: E("settle"), stagger: { each: 0.012, from: "random" } }, `${at}+=0.1`);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-24">
        <h2 data-a="headline" className="font-display text-8xl leading-none">
          This can’t be paid.
        </h2>
        <ol className="mt-12 max-w-[900px] border-t border-ink">
          {["It isn’t sealed", "It asks for a new address", "It came from a look-alike domain", "It tries to hurry you"].map((r) => (
            <li key={r} data-a="reason" className="flex items-center gap-4 border-b border-rule py-5 text-2xl">
              <Tick cross />
              {r}
            </li>
          ))}
        </ol>
      </div>
    ),
    build: (tl, q, at) => {
      blurIn(tl, a(q, "headline"), at);
      writeIn(tl, a(q, "reason"), `${at}+=0.35`);
      draw(tl, a(q, "cross"), `${at}+=0.45`, S.row);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-32">
        <div className="flex gap-4">
          <button data-a="warn" className="rounded-doc bg-ink px-7 py-4 text-xl font-medium text-paper">
            Warn Studio Ana
          </button>
          <button className="rounded-doc border border-red px-7 py-4 text-xl font-medium text-red">Mark as fraud</button>
          <button className="rounded-doc border border-rule px-7 py-4 text-xl font-medium">Ask for a sealed invoice</button>
        </div>
        <p data-a="warned" className="mt-12 flex items-baseline gap-6 border-b border-rule pb-4 text-2xl">
          <span className="font-mono text-base text-graphite">10:06</span> Studio Ana warned. Nothing was paid.
        </p>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "warn"), { backgroundColor: "rgba(0,0,0,0)", color: "var(--ink)", duration: D.quick }, `${at}+=0.4`);
      tl.from(a(q, "warn"), { scale: 0.97, duration: D.tick, ease: E("settle") }, `${at}+=0.4`);
      writeIn(tl, a(q, "warned"), `${at}+=0.65`);
    },
  },
];

const sealScenes: Scene[] = [
  {
    render: () => (
      <div className="flex items-end justify-center gap-16 pt-20">
        <div className="w-[560px] rounded-doc border border-rule bg-paper-raised p-10">
          <p className="font-display text-4xl">New invoice</p>
          {invoice.lines.map((l) => (
            <div key={l.description} data-a="line" className="flex justify-between border-b border-rule-soft py-4 text-lg">
              <span>{l.description}</span>
              <span data-a="amt">{Number(l.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
            </div>
          ))}
          <div className="mt-5 flex items-baseline justify-between border-t-2 border-ink pt-4">
            <span className="text-lg">Total</span>
            <span data-a="total" className="font-display text-5xl">
              2,400.00
            </span>
          </div>
        </div>
        <div className="flex items-end gap-3 pb-2">
          {invoice.earlyPay.map((t, i) => (
            <div key={t.label} className="text-center">
              <div data-a="tier" className={`w-24 origin-bottom border ${i < 2 ? "border-seal bg-seal-wash" : "border-rule"}`} style={{ height: [150, 100, 50][i] }} />
              <p className="mt-2 text-sm">{t.bps ? `${(t.bps / 100).toFixed(2)}%` : "0%"}</p>
              <p className="text-xs text-graphite">{t.label}</p>
            </div>
          ))}
        </div>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "line"), { opacity: 0, y: 10, duration: D.base, ease: E("arrive"), stagger: 0.25 }, at);
      a(q, "amt").forEach((el, i) => roll(tl, el, 0, `${at}+=${0.1 + i * 0.25}`, D.quick * 2));
      roll(tl, one(q, "total"), 0, `${at}+=0.8`, D.move);
      tl.from(a(q, "tier"), { scaleY: 0, duration: D.base, ease: E("arrive"), stagger: S.row }, `${at}+=1.1`);
    },
  },
  {
    render: () => (
      <div className="relative flex justify-center pt-16">
        <div data-a="doc" className="relative">
          <StudioAnaHalf />
          <div data-a="stamp" className="absolute right-20 top-8">
            <SealStamp handle={vendor.handle} size={96} className="rotate-[-8deg]" />
          </div>
        </div>
        <div data-a="sheet" className="absolute bottom-0 left-1/2 w-[620px] -translate-x-1/2 rounded-t-2xl border border-rule bg-paper-raised px-10 py-8 opacity-0 shadow-[0_-10px_40px_rgba(21,33,28,0.12)]">
          <p className="text-lg">You’re signing invoice 0142 for 2,400.00 USDC to Acme Operations.</p>
          <button className="mt-5 w-full rounded-doc bg-ink py-4 text-lg font-medium text-paper">Seal and send</button>
        </div>
      </div>
    ),
    build: (tl, q, at) => {
      // The signing sheet rises, is used, and goes; then the stamp strikes and the edge is cut, top to bottom
      tl.fromTo(a(q, "sheet"), { opacity: 1, y: 260 }, { y: 0, duration: D.base, ease: E("arrive") }, at);
      tl.to(a(q, "sheet"), { y: 260, opacity: 0, duration: D.base, ease: E("depart") }, `${at}+=0.7`);
      strike(tl, a(q, "stamp"), `${at}+=0.9`);
      tl.from(q('[data-seam="line"], [data-seam="letters"]'), { clipPath: "inset(0 0 100% 0)", duration: 0.6, ease: E("settle") }, `${at}+=1.05`);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-20">
        <h2 className="font-display text-5xl">Invoices</h2>
        <ul className="mt-8 border-t border-ink text-lg">
          <li data-a="sent" className="grid grid-cols-[6rem_1fr_auto_16rem] gap-6 border-b border-rule bg-paper-raised px-2 py-4">
            <span className="font-mono">0142</span>
            <span>Acme Operations</span>
            <span>2,400.00</span>
            <span className="text-right text-graphite">Sent · not yet viewed</span>
          </li>
          {[
            ["0141", "Halden Retail", "1,800.00", "Paid 12 Sep"],
            ["0140", "Northwind Agency", "3,250.00", "Paid 2 Sep"],
          ].map(([n, w, amt, s]) => (
            <li key={n} className="grid grid-cols-[6rem_1fr_auto_16rem] gap-6 border-b border-rule px-2 py-4 text-graphite">
              <span className="font-mono">{n}</span>
              <span>{w}</span>
              <span>{amt}</span>
              <span className="text-right">{s}</span>
            </li>
          ))}
        </ul>
        <div data-a="flying" className="absolute left-1/2 top-24 h-[420px] w-[340px] -translate-x-1/2 rounded-doc border border-rule bg-paper-raised opacity-0 shadow-lg" />
      </div>
    ),
    build: (tl, q, at) => {
      // Shared-element move: the sealed document shrinks into its row
      tl.fromTo(a(q, "flying"), { opacity: 1, scale: 1, y: 0 }, { opacity: 0, scale: 0.12, y: -60, x: -300, duration: D.move, ease: E("settle") }, at);
      tl.from(a(q, "sent"), { backgroundColor: "var(--seal-wash)", duration: D.move }, `${at}+=0.45`);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-14">
        <h2 data-a="headline" className="max-w-[900px] font-display text-6xl leading-[1.02]">
          Studio Ana sent you an invoice for 2,400 USDC.
        </h2>
        <div className="mt-10 flex">
          <div data-a="vendor">
            <StudioAnaHalf />
          </div>
          <div data-a="ghost" className="-ml-[22px]">
            <AcmeHalf ghost tone="var(--graphite)" rows={[["Your order", "—"], ["Delivery", "—"], ["Approval", "—"]]} />
          </div>
        </div>
      </div>
    ),
    build: (tl, q, at) => {
      blurIn(tl, a(q, "headline"), at);
      tl.from(a(q, "vendor"), { x: -80, opacity: 0, duration: D.move, ease: E("arrive") }, `${at}+=0.2`);
      tl.from(q('[data-a="ghost"] [data-seam="line"]'), { clipPath: "inset(0 0 100% 0)", duration: D.move, ease: E("settle") }, `${at}+=0.5`);
      tl.from(a(q, "ghost"), { opacity: 0, duration: D.base }, `${at}+=0.45`);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-24">
        <div className="relative flex max-w-[900px] justify-between">
          <div className="absolute left-4 right-4 top-4 h-px bg-rule" />
          <div data-a="progress" className="absolute left-4 right-4 top-4 h-0.5 origin-left bg-seal" />
          {["Create the Vault", "Fund it", "Pick a policy"].map((s) => (
            <div key={s} data-a="step" className="relative z-10 text-center">
              <span className="mx-auto grid h-8 w-8 place-items-center rounded-full border-2 border-seal bg-paper">
                <Tick />
              </span>
              <p className="mt-3 text-lg">{s}</p>
            </div>
          ))}
        </div>
        <p className="mt-16 text-graphite">Vault</p>
        <p data-a="address" className="font-mono text-3xl">
          0x7a3f…c219
        </p>
        <p className="mt-10 text-graphite">Balance</p>
        <p data-a="balance" className="font-display text-8xl leading-none">
          10,000.00
        </p>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "progress"), { scaleX: 0, duration: 1.2, ease: E("settle") }, at);
      tl.from(a(q, "step"), { opacity: 0.25, duration: D.quick, stagger: 0.5 }, at);
      draw(tl, a(q, "tick"), `${at}+=0.1`, 0.5);
      resolveText(tl, one(q, "address"), `${at}+=0.2`);
      roll(tl, one(q, "balance"), 0, `${at}+=0.7`, 0.8);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-28 text-center">
        <p className="text-xl text-graphite">Code exchanged with Studio Ana on your usual Slack thread</p>
        <p className="mt-6 flex justify-center gap-5 font-mono text-8xl">
          {"417920".split("").map((d, i) => (
            <span key={i} data-a="digit" className={i === 3 ? "ml-8" : ""}>
              {d}
            </span>
          ))}
        </p>
        <div data-a="badge" className="mx-auto mt-16 inline-block rotate-[-6deg] rounded-sm border-2 border-seal px-8 py-3 font-mono text-2xl font-semibold uppercase tracking-[0.3em] text-seal">
          Verified for Acme
        </div>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "digit"), { y: 18, opacity: 0, duration: D.quick, ease: E("arrive"), stagger: S.letter * 2 }, at);
      tl.from(a(q, "badge"), { rotationX: -90, opacity: 0, color: "var(--graphite)", borderColor: "var(--rule)", duration: 0.4, ease: E("arrive") }, `${at}+=0.45`);
    },
  },
];

const paysScenes: Scene[] = [
  {
    render: () => <Inbox top={{ who: "Studio Ana", what: "Retainer 0143", amount: "2,000.00", tag: "Verified", tone: "seal" }} />,
    build: (tl, q, at) => {
      tl.from(a(q, "new"), { opacity: 0, y: -24, duration: D.arrive, ease: E("arrive") }, at);
      tl.from(a(q, "rest"), { y: -61, duration: D.arrive, ease: E("arrive") }, at);
    },
  },
  {
    render: () => (
      <div className="flex justify-center gap-20 pt-24">
        <StudioAnaHalf fp={retainer.fingerprint} rows={retainerRows} />
        <div data-a="acme">
          <AcmeHalf fp={retainer.fingerprint} />
        </div>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "acme"), { opacity: 0.35, duration: D.base }, at);
      tl.from(a(q, "acme-row"), { x: 220, opacity: 0, duration: D.move, ease: E("arrive"), stagger: 0.08 }, at);
      tl.from(q('[data-a="acme"] [data-seam="line"]'), { clipPath: "inset(0 0 100% 0)", duration: D.base, ease: E("settle") }, `${at}+=0.55`);
    },
  },
  {
    render: () => (
      <div className="relative flex justify-center pt-24">
        <div data-a="left">
          <StudioAnaHalf fp={retainer.fingerprint} rows={retainerRows} tone="var(--seal)" />
        </div>
        <div data-a="right" className="-ml-[22px]">
          <AcmeHalf fp={retainer.fingerprint} tone="var(--seal)" />
        </div>
        <div data-a="stamp" className="absolute left-1/2 top-[196px] -translate-x-1/2 rotate-[-9deg] rounded-sm border-2 border-seal bg-paper-raised/90 px-6 py-2 font-mono text-xl font-semibold uppercase tracking-[0.3em] text-seal">
          Matched
        </div>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "left"), { x: -60, duration: D.deliberate, ease: E("close") }, at);
      tl.from(a(q, "right"), { x: 60, duration: D.deliberate, ease: E("close") }, at);
      strike(tl, a(q, "stamp"), `${at}+=${D.deliberate + 0.12}`);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-16">
        <h2 className="font-display text-5xl">The Steward checked</h2>
        <ol className="mt-8 max-w-[1000px] border-t border-ink">
          {[
            ["Sealed by Studio Ana", "Verified for Acme since 12 Sep"],
            ["Matches PO-0031", "Design retainer, 2,000.00 a month"],
            ["Delivery confirmed", "October sign-off in Linear"],
            ["Within the auto-pay limit", "2,000.00 of 2,500.00"],
            ["Within the Design budget", "6,000.00 left this month"],
            ["Never paid before", "This fingerprint has no payments"],
            ["Worth paying early", "9.1% a year against 6.2%"],
          ].map(([r, d]) => (
            <li key={r} data-a="check" className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-rule py-3.5 text-xl">
              <Tick />
              <span>{r}</span>
              <span className="text-base text-graphite">{d}</span>
            </li>
          ))}
        </ol>
      </div>
    ),
    build: (tl, q, at) => {
      writeIn(tl, a(q, "check"), at);
      draw(tl, a(q, "tick"), `${at}+=0.2`, S.row);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-16">
        <h2 className="font-display text-5xl">Worth paying early?</h2>
        <div className="relative mt-10 flex h-[420px] max-w-[760px] items-end gap-24 border-b border-ink pl-10">
          <div data-a="threshold" className="absolute left-0 right-0 border-t-2 border-dashed border-ink" style={{ bottom: `${(6.2 / 10) * 100}%` }}>
            <span className="absolute -top-8 right-0 text-base text-graphite">Reserve 3.2% + 3 points = 6.2%</span>
          </div>
          <div className="text-center">
            <p className="mb-3 text-2xl font-medium">9.1%</p>
            <div data-a="bar" className="w-32 origin-bottom bg-seal" style={{ height: 380 * 0.91 }} />
          </div>
          <div className="text-center">
            <p className="mb-3 text-2xl text-graphite">3.2%</p>
            <div data-a="bar" className="w-32 origin-bottom border-2 border-graphite" style={{ height: 380 * 0.32 }} />
          </div>
        </div>
        <p data-a="verdict" className="mt-8 font-display text-5xl text-seal">
          Pay now.
        </p>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "bar"), { scaleY: 0, duration: D.move, ease: E("arrive") }, at);
      tl.from(a(q, "threshold"), { opacity: 0, y: -30, duration: D.base, ease: E("arrive") }, `${at}+=0.1`);
      tl.from(a(q, "verdict"), { opacity: 0, y: 8, duration: D.base, ease: E("arrive") }, `${at}+=0.45`);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-24">
        <p className="text-xl text-graphite">Steward, 09:12</p>
        <p className="mt-3 font-display text-9xl leading-none">
          Paid <span data-a="amount">1,985.00</span>
        </p>
        <p data-a="settled" className="mt-5 text-2xl text-graphite">
          To Studio Ana, 30 days early for 0.75% off · settled in 0.6 s
        </p>
        <p data-a="ledger" className="mt-16 flex max-w-[1000px] items-baseline gap-6 border-y border-rule py-4 text-xl">
          <span className="font-mono text-base text-graphite">09:12</span> Paid Studio Ana, retainer 0143
          <span className="ml-auto">1,985.00</span>
        </p>
      </div>
    ),
    build: (tl, q, at) => {
      roll(tl, one(q, "amount"), 2000, at, 0.6);
      tl.from(a(q, "settled"), { opacity: 0, duration: D.base }, `${at}+=0.5`);
      writeIn(tl, a(q, "ledger"), `${at}+=0.7`);
    },
  },
];

const todayScenes: Scene[] = [
  {
    render: () => (
      <Phone>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-graphite">Invoice 2291 · Acme</p>
        <p className="mt-4 font-display text-5xl">9,000.00</p>
        <p className="mt-2 text-graphite">Due in 25 days</p>
        <button data-a="ask" className="absolute bottom-10 left-4 right-4 overflow-hidden rounded-doc bg-ink py-4 text-lg font-medium text-paper">
          Get paid today
          <span data-a="shimmer" className="absolute inset-y-0 left-0 w-1/3 -translate-x-full bg-gradient-to-r from-transparent via-seal/40 to-transparent" />
        </button>
      </Phone>
    ),
    build: (tl, q, at) => {
      tl.fromTo(a(q, "shimmer"), { xPercent: -100 }, { xPercent: 400, duration: 1.1, ease: "none" }, `${at}+=0.3`);
    },
  },
  {
    render: () => (
      <Phone>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-graphite">Get paid today</p>
        <p className="mt-6 text-graphite">Discount you offer</p>
        <div className="relative mt-5 h-10">
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 bg-rule" />
          <div className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm bg-seal-wash" style={{ left: "33%", right: "50%" }} />
          <div data-a="thumb" className="absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-paper-raised" style={{ left: "40%" }} />
        </div>
        <p className="text-xs text-graphite">Accepted before: 1.0–1.5%</p>
        <p className="mt-8 text-graphite">You receive today</p>
        <p data-a="receive" className="font-display text-5xl">
          8,892.00
        </p>
        <p className="mt-1 text-graphite">
          <span data-a="pct">1.20</span>% off 9,000.00
        </p>
        <button className="absolute bottom-10 left-4 right-4 rounded-doc bg-ink py-4 text-lg font-medium text-paper">Sign offer</button>
      </Phone>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "thumb"), { left: "0%", duration: 1.0, ease: E("settle") }, at);
      roll(tl, one(q, "receive"), 9000, at, 1.0);
      roll(tl, one(q, "pct"), 0, at, 1.0);
    },
  },
  {
    render: () => (
      <Phone>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-graphite">Acme · approver</p>
        <div data-a="card" className="absolute bottom-6 left-3 right-3 rounded-2xl border border-seal/50 bg-paper p-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-seal">Early Pay request</p>
          <p className="mt-2 text-lg font-medium">Northwind wants 8,892.00 today instead of 9,000.00 in 25 days</p>
          <div className="mt-3 border-l-2 border-seal pl-3 text-sm">
            Recommend accepting: about 17.5% a year. Needs 5,000.00 from reserve. Runway after: 52 days.
          </div>
          <p className="mt-3 text-xs text-graphite">Above the 2,500.00 auto-pay limit, so you sign</p>
          <button className="mt-4 w-full rounded-doc bg-ink py-3 font-medium text-paper">Approve and sign</button>
        </div>
      </Phone>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "card"), { y: 420, duration: D.move, ease: E("arrive") }, at);
    },
  },
  {
    render: () => (
      <div className="flex items-end justify-center gap-40 pt-24">
        {[
          { name: "Reserve", h: 170, v: "17,000.00", tone: "border-seal bg-seal-wash" },
          { name: "Operating", h: 322, v: "34,428.00", tone: "border-ink bg-paper-raised" },
        ].map((b) => (
          <div key={b.name} className="text-center">
            <p data-a={`v-${b.name}`} className="mb-3 text-2xl font-medium">
              {b.v}
            </p>
            <div data-a={`bar-${b.name}`} className={`w-44 origin-bottom border-2 ${b.tone}`} style={{ height: b.h }} />
            <p className="mt-3 text-lg text-graphite">{b.name}</p>
          </div>
        ))}
        <div data-a="flow" className="absolute left-[calc(50%-150px)] top-[380px] h-14 w-40 rounded-sm bg-seal/70 opacity-0" />
      </div>
    ),
    build: (tl, q, at) => {
      // 5,000 from reserve to operating, then 8,892 paid out of operating (38,320 + 5,000 − 8,892 = 34,428)
      tl.fromTo(a(q, "flow"), { opacity: 1, x: -40 }, { x: 270, opacity: 0, duration: 0.6, ease: E("settle") }, at);
      tl.from(a(q, "bar-Reserve"), { height: 220, duration: 0.6, ease: E("settle") }, at);
      roll(tl, one(q, "v-Reserve"), 22000, at, 0.6);
      tl.from(a(q, "bar-Operating"), { height: 360, duration: D.base, ease: E("settle") }, `${at}+=0.75`);
      roll(tl, one(q, "v-Operating"), 43320, `${at}+=0.75`, D.base);
    },
  },
  {
    render: () => (
      <Phone>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">Paid today</p>
        <p data-a="paid" className="mt-4 font-display text-6xl">
          8,892.00
        </p>
        <div data-a="receipt" className="mt-8 overflow-hidden border-t border-rule text-sm">
          {[
            ["Invoice", "2291"],
            ["Original", "9,000.00"],
            ["Discount", "1.20%"],
            ["Paid", "Today, 14:08"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-rule-soft py-3">
              <span className="text-graphite">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </Phone>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "paid"), { scale: 1.06, opacity: 0, duration: D.base, ease: E("strike") }, at);
      tl.from(a(q, "receipt"), { clipPath: "inset(0 0 100% 0)", duration: 0.4, ease: E("settle") }, `${at}+=0.3`);
    },
  },
];

const guardScenes: Scene[] = [
  {
    render: () => (
      <div className="px-24 pt-20">
        <h2 className="font-display text-5xl">Steward’s ledger</h2>
        <ol className="mt-8 max-w-[1000px] border-t border-ink text-xl">
          <li data-a="retry" className="grid grid-cols-[5rem_1fr_auto] gap-4 border-b border-rule py-4">
            <span className="font-mono text-base text-graphite">09:13</span>
            <span>
              Retry of 0143 refused by the Vault: <span className="text-red">already paid</span>
            </span>
            <span className="relative">
              1,985.00
              <span data-a="strike" className="absolute left-0 right-0 top-1/2 h-0.5 origin-left bg-red" />
            </span>
          </li>
          <li className="grid grid-cols-[5rem_1fr_auto] gap-4 border-b border-rule py-4 text-graphite">
            <span className="font-mono text-base">09:12</span>
            <span>Paid Studio Ana, retainer 0143</span>
            <span>1,985.00</span>
          </li>
        </ol>
      </div>
    ),
    build: (tl, q, at) => {
      writeIn(tl, a(q, "retry"), at);
      tl.from(a(q, "strike"), { scaleX: 0, duration: D.base, ease: E("settle") }, `${at}+=0.3`);
    },
  },
  {
    render: () => (
      <div className="grid grid-cols-2 gap-16 px-24 pt-20">
        <div>
          <h2 className="font-display text-4xl">Needs you</h2>
          <div data-a="card" className="mt-6 rounded-doc border border-red/60 bg-paper-raised p-6">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-red">Over 10,000.00: owner signs</p>
            <p className="mt-2 text-xl font-medium">Forge Supply F-778 · 14,000.00</p>
            <p className="mt-1 text-graphite">Delivery confirmed. Recommend paying on the due date.</p>
          </div>
        </div>
        <div>
          <h2 className="font-display text-4xl">Steward’s ledger</h2>
          <div className="mt-6 border-t border-ink">
            {["Paid Cloudline", "Paid Halden Freight", "Swept to reserve"].map((r) => (
              <p key={r} className="border-b border-rule py-4 text-lg text-graphite">
                {r}
              </p>
            ))}
          </div>
        </div>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "card"), { x: 600, duration: D.move + 0.1, ease: E("settle") }, at);
    },
  },
  {
    render: () => (
      <div className="px-24 pt-16">
        <div data-a="rule" className="absolute left-0 right-0 top-0 h-1.5 origin-left bg-red" />
        <div className="flex items-center justify-between">
          <h2 data-a="title" className="font-display text-6xl text-red">
            Payments paused
          </h2>
          <button className="rounded-doc border border-red px-5 py-3 text-lg font-medium text-red">Resume payments</button>
        </div>
        <div data-a="app" className="mt-10 max-w-[1000px] border-t border-ink text-xl saturate-[0.4]">
          {["Studio Ana 0142 · 28 Oct", "Kestrel Labs KL-301 · 22 Oct", "Forge Supply F-778 · 13 Oct"].map((r) => (
            <p key={r} className="flex justify-between border-b border-rule py-4">
              {r}
              <span data-a="paused" className="font-mono text-sm uppercase tracking-[0.14em] text-red">
                Paused
              </span>
            </p>
          ))}
        </div>
      </div>
    ),
    build: (tl, q, at) => {
      tl.from(a(q, "rule"), { scaleX: 0, duration: 0.4, ease: E("settle") }, at);
      tl.from(a(q, "title"), { opacity: 0, duration: D.base }, `${at}+=0.1`);
      tl.from(a(q, "app"), { filter: "saturate(1)", duration: 0.4 }, `${at}+=0.1`);
      tl.from(a(q, "paused"), { opacity: 0, duration: D.quick, stagger: 0.06 }, `${at}+=0.3`);
    },
  },
];

export const scenes: Record<string, Scene[]> = {
  fraud: fraudScenes,
  "seal-and-join": sealScenes,
  "steward-pays": paysScenes,
  "paid-today": todayScenes,
  guardrails: guardScenes,
};
