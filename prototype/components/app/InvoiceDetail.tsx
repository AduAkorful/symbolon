"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Half } from "@/components/Chirograph";
import { SealStamp } from "@/components/Marks";
import { Money } from "@/components/Money";
import { TxLink } from "@/components/TxLink";
import type { Invoice } from "@/lib/acme";
import { D, E, registerMotion, strike } from "@/lib/motion";
import { tx } from "@/lib/tx";
import { usePause } from "./pause";
import { StatusTag, TrustTag } from "./tags";
import { Act } from "@/components/Act";

const AMP = 11;

/**
 * One invoice from Acme's side (B6): the vendor's sealed half beside Acme's half of evidence. When every piece of
 * evidence holds, the halves close and are stamped; otherwise they stay apart with the missing piece in red.
 */
export function InvoiceDetail({ inv }: { inv: Invoice }) {
  const { paused } = usePause();
  const [delivered, setDelivered] = useState(false);
  const acme = inv.acme.map((h) => (h.label === "Delivery" && delivered ? { ...h, value: "Confirmed just now by you", ok: true } : h));
  // Approval pending doesn't keep the halves apart: they match, and the payment then waits for a signature
  const evidenceOk = acme.filter((h) => h.label !== "Approval").every((h) => h.ok);
  const needsSignature = acme.some((h) => h.label === "Approval" && !h.ok);

  const stage = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // The match: halves close with the "close" ease, then the stamp strikes (storyboard: Steward pays, beat 3)
  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!stage.current || reduce || !evidenceOk) {
      first.current = false;
      return;
    }
    registerMotion();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ delay: first.current ? 0.25 : 0 });
      tl.from("[data-a=left]", { x: -40, duration: D.deliberate, ease: E("close") }, 0);
      tl.from("[data-a=right]", { x: 40, duration: D.deliberate, ease: E("close") }, 0);
      strike(tl, "[data-a=stamp]", D.deliberate + 0.12);
    }, stage);
    first.current = false;
    return () => ctx.revert();
  }, [evidenceOk]);

  const sealedRows: [string, string][] = [
    ["No.", inv.number],
    ["Amount", `${Number(inv.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC`],
    ["Issued", inv.issued],
    ["Due", inv.due],
    ["Match", inv.match],
  ];

  return (
    <main className="px-6 pb-20 pt-8 md:px-10">
      <p data-reveal className="text-sm text-graphite">
        <Link href="/b/inbox" className="hover:text-ink">
          Inbox
        </Link>{" "}
        <span className="mx-1.5">/</span> {inv.vendor} {inv.number}
      </p>
      <div data-reveal className="mt-3 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex flex-wrap items-center gap-4">
            <TrustTag trust={inv.trust} />
            <StatusTag status={delivered && inv.id === "forge-f778" ? "awaiting_approval" : inv.status} paused={paused} />
          </div>
          <h1 className="mt-2 font-display text-[clamp(2.6rem,5vw,4.2rem)] leading-none">
            <Money raw={inv.amount} symbol="$" precise={false} />
          </h1>
          <p className="mt-2 text-graphite">
            {inv.vendor} · invoice {inv.number} ·{" "}
            {delivered && inv.id === "forge-f778" ? "Delivery confirmed; waiting for the owner’s signature" : inv.statusNote}
          </p>
        </div>
      </div>

      <div className="mt-10 grid gap-12 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section aria-label="The two halves" data-reveal>
          <div ref={stage} className={`relative flex ${evidenceOk ? "" : "gap-10"}`}>
            <div data-a="left" className="w-1/2 drop-shadow-[0_14px_24px_rgba(21,33,28,0.10)]">
              <Half side="vendor" fingerprint={inv.fingerprint} amplitude={AMP} className="h-full bg-paper-raised" tone={evidenceOk ? "var(--seal)" : "var(--rule)"}>
                <div className="px-6 py-7 pr-12">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">Sealed invoice</p>
                  <p className="mt-2 font-display text-2xl leading-none">{inv.vendor}</p>
                  <p className="mt-1 font-mono text-xs text-graphite">{inv.handle}</p>
                  {inv.handle ? <SealStamp handle={inv.handle} size={54} className="mt-4 rotate-[-6deg]" /> : null}
                  <dl className="mt-4 text-sm">
                    {sealedRows.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 border-b border-rule-soft py-2.5">
                        <dt className="text-graphite">{k}</dt>
                        <dd className="text-right">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Half>
            </div>
            <div data-a="right" className={`drop-shadow-[0_14px_24px_rgba(21,33,28,0.10)] ${evidenceOk ? "-ml-[22px] w-[calc(50%+22px)]" : "w-1/2"}`}>
              <Half
                side="payer"
                fingerprint={inv.fingerprint}
                amplitude={AMP}
                className={`h-full ${evidenceOk ? "bg-paper-raised" : "bg-paper/70"}`}
                tone={evidenceOk ? "var(--seal)" : "var(--graphite)"}
              >
                <div className="px-6 py-7 pl-24">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">Acme’s half</p>
                  <p className="mt-2 font-display text-2xl leading-none">Acme Operations</p>
                  <ul className="mt-5 text-sm">
                    {acme.map((h) => (
                      <li key={h.label} className="border-b border-rule-soft py-2.5">
                        <p className="flex items-center gap-2 text-graphite">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${h.ok ? "bg-seal" : h.label === "Approval" ? "bg-graphite" : "bg-red"}`} />
                          {h.label}
                        </p>
                        <p className={`mt-0.5 ${h.ok || h.label === "Approval" ? "" : "text-red"}`}>{h.value}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </Half>
            </div>
            {evidenceOk ? (
              <div
                data-a="stamp"
                className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rotate-[-9deg] rounded-sm border-2 border-seal bg-paper-raised/90 px-4 py-1.5 font-mono text-sm font-semibold uppercase tracking-[0.3em] text-seal"
              >
                Matched
              </div>
            ) : null}
          </div>
          <p className="mt-4 text-sm text-graphite">
            {evidenceOk
              ? "Both halves were cut from this invoice’s fingerprint, and every piece of Acme’s evidence holds."
              : "The halves stay apart until Acme’s evidence is complete. Nothing is paid against a missing piece."}
          </p>
        </section>

        <section aria-labelledby="steward" className="space-y-8">
          <div data-reveal>
            <h2 id="steward" className="font-display text-3xl">
              Steward
            </h2>
            <p className="mt-3 border-l-2 border-seal pl-4 text-lg leading-snug">
              {delivered && inv.id === "forge-f778"
                ? "Delivery confirmed, so the halves match. Pay on 13 Oct, the due date: no discount is offered, and the cash earns reserve yield until then. Over $10,000.00, so the owner signs."
                : inv.steward.says}
            </p>
            <p className="mt-3 text-sm text-graphite">Rule: {inv.steward.rule}</p>
            <Link href={`/b/decisions/${inv.decisionId}`} className="mt-2 inline-block text-sm underline decoration-rule underline-offset-4 hover:text-seal">
              The full decision record
            </Link>
          </div>

          {inv.earlyPay.length ? (
            <div data-reveal>
              <h3 className="text-sm font-medium">Early Pay the vendor signed</h3>
              <ol className="mt-3 grid gap-px overflow-hidden rounded-doc border border-rule bg-rule sm:grid-cols-3">
                {inv.earlyPay.map((t) => (
                  <li key={t.label} className="bg-paper-raised px-4 py-3">
                    <p className="text-xs text-graphite">
                      {t.label} · {t.until}
                    </p>
                    <p className="mt-1 text-lg font-medium">
                      <Money raw={t.pay} symbol="$" precise={false} />
                    </p>
                    <p className="text-xs text-graphite">{t.bps ? `${(t.bps / 100).toFixed(2)}% off` : "Full amount"}</p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div data-reveal className="border-t border-rule pt-5">
            <Actions inv={inv} paused={paused} delivered={delivered} onDelivered={() => setDelivered(true)} needsSignature={needsSignature} />
          </div>
        </section>
      </div>
    </main>
  );
}

function Actions({
  inv,
  paused,
  delivered,
  onDelivered,
  needsSignature,
}: {
  inv: Invoice;
  paused: boolean;
  delivered: boolean;
  onDelivered: () => void;
  needsSignature: boolean;
}) {
  const btn = "rounded-doc px-4 py-2.5 text-sm font-medium transition-colors duration-[var(--dur-quick)]";
  if (inv.status === "paid")
    return (
      <p className="text-sm">
        Paid $1,985.00 at 09:12, settled in 0.6 s. <TxLink hash={tx.payAna}>Transaction {tx.payAna}</TxLink>{" "}
        <Link href={`/b/decisions/${inv.decisionId}`} className="underline decoration-rule underline-offset-4">
          Record
        </Link>
      </p>
    );
  if (inv.status === "awaiting_approval")
    return (
      <Link href="/b/approvals" className={`${btn} inline-block bg-ink text-paper`}>
        Review and sign
      </Link>
    );
  if (inv.trust === "new")
    return (
      <div className="flex flex-wrap gap-3">
        <Link href="/b/vendors" className={`${btn} bg-ink text-paper`}>
          Verify Kestrel Labs
        </Link>
        <p className="w-full text-sm text-graphite">Use a code over a channel you already share, a contact you already have, or a small test payment.</p>
      </div>
    );
  if (inv.id === "forge-f778")
    return delivered ? (
      <div>
        <p className="text-sm">
          Delivery confirmed. Over $10,000.00, so it waits for the owner’s signature; the Steward recommends paying on {inv.due}.
        </p>
        {needsSignature ? (
          <button disabled={paused} className={`${btn} mt-3 bg-ink text-paper disabled:opacity-40`}>
            {paused ? "Payments are paused" : "Approve and sign"}
          </button>
        ) : null}
      </div>
    ) : (
      <div className="flex flex-wrap gap-3">
        <button onClick={onDelivered} className={`${btn} bg-ink text-paper`}>
          Confirm delivery
        </button>
        <Act className={`${btn} border border-rule hover:border-ink`} done="Asked Dele again by email, just now. He’ll see it on his orders.">Ask Dele again</Act>
        <Act
          className={`${btn} border border-red/60 text-red hover:bg-red-wash`}
          confirm={{ title: "Reject the delivery", body: "The vendor is told with your reason, and the invoice stays held.", action: "Reject delivery", field: { label: "Reason", placeholder: "Wrong colours on the print run" } }}
          done={(reason) => `Rejected: ${reason}. The vendor has been told; the invoice stays held.`}
        >
          Reject delivery
        </Act>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm">{paused ? "Paused. It goes out when you resume, if the rules still hold." : inv.statusNote + "."}</p>
      <button disabled={paused} className={`${btn} border border-rule hover:border-ink disabled:opacity-40`}>
        Change the date
      </button>
    </div>
  );
}

