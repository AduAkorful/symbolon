import { Half } from "@/components/Chirograph";
import { Scatter } from "@/components/Scatter";
import { fraud, retainer, vendor } from "@/lib/demo";
import { Act } from "@/components/Act";

const reasons = [
  {
    title: "It isn’t sealed",
    body: "Anyone can make a PDF. Only Studio Ana’s Seal can sign a Studio Ana invoice, and this one carries no Seal.",
  },
  {
    title: "It asks for a new address",
    body: "Acme can only pay Studio Ana at the address the studio’s Seal signed. A new one can only arrive as a sealed change, then waits 72 hours for your confirmation.",
  },
  {
    title: "It came from a look-alike domain",
    body: "studio-anna.co, not the address Studio Ana’s invoices come from.",
  },
  {
    title: "It tries to hurry you",
    body: "“Pay today to avoid late fees.” Text in a document is treated as data, never as an instruction.",
  },
];

/** The unsigned "new wallet" invoice that can’t be paid (Flow 6, B7) */
export function RefusalView() {
  return (
      <main className="px-6 pb-20 pt-8 md:px-10">
        <p className="text-sm text-graphite">
          Inbox <span className="mx-1.5">/</span> <span className="text-red">Unsigned</span>
        </p>
        <h1 className="mt-3 font-display text-[clamp(2.6rem,5vw,4.2rem)] leading-[0.98]">This can’t be paid.</h1>
        <p className="mt-3 max-w-[60ch] text-graphite">
          An email claiming to be {vendor.name} asks Acme to pay invoice #0150 to a new wallet. Nothing was paid, and nothing
          in it can be.
        </p>

        <div className="mt-10 grid gap-12 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* What arrived, beside the half it would have to fit */}
          <section aria-label="The document and why it doesn't fit">
            <div className="rounded-doc border border-rule bg-paper-raised/60 px-5 py-3 text-sm">
              <p>
                <span className="text-graphite">From</span> <span className="font-mono text-red">{fraud.from}</span>
              </p>
              <p className="mt-1 truncate">
                <span className="text-graphite">Subject</span> {fraud.subject}
              </p>
            </div>

            <div className="relative mt-5 flex items-stretch">
              <Half side="vendor" fingerprint={fraud.fingerprint} amplitude={11} className="w-[52%] bg-paper-raised" tone="var(--red)" seamClassName="opacity-0">
                <div className="px-6 py-7 pr-12">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-red">Unsigned PDF</p>
                  <p className="mt-2 font-display text-2xl leading-none">Studio Ana</p>
                  <div className="mt-5 grid h-[58px] w-[58px] place-items-center rounded-full border-2 border-dashed border-red/60 text-center text-[10px] leading-tight text-red">
                    no
                    <br />
                    Seal
                  </div>
                  <dl className="mt-5 text-sm">
                    {[
                      ["No.", "0150"],
                      ["Amount", fraud.claimedAmount],
                      ["Pay to", fraud.newAddress],
                      ["Note", "Pay today to avoid late fees"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 border-b border-rule-soft py-2.5">
                        <dt className="text-graphite">{k}</dt>
                        <dd className={k === "Pay to" ? "font-mono text-red" : ""}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Half>

              {/* The fragments drifting out of the cut: this edge was never cut to fit anything */}
              <div className="relative w-[9%] overflow-hidden">
                <Scatter text={fraud.fingerprint.replace(/^0x/, "").slice(0, 16).toUpperCase()} />
              </div>

              {/* Acme's half for Studio Ana: its real edge, which the fake can't meet */}
              <Half side="payer" fingerprint={retainer.fingerprint} className="w-[39%] bg-paper/60" tone="var(--graphite)" seamClassName="opacity-60">
                <div className="px-6 py-7 pl-11">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-graphite">Acme’s side</p>
                  <p className="mt-2 font-display text-2xl leading-none">Studio Ana</p>
                  <p className="mt-5 text-sm text-graphite">Verified 12 Sep</p>
                  <dl className="mt-5 text-sm">
                    <div className="border-b border-rule-soft py-2.5">
                      <dt className="text-graphite">Pays only to</dt>
                      <dd className="mt-0.5 font-mono">{vendor.payout}</dd>
                    </div>
                    <div className="border-b border-rule-soft py-2.5">
                      <dt className="text-graphite">Address changes</dt>
                      <dd className="mt-0.5">Sealed, then 72 h</dd>
                    </div>
                  </dl>
                </div>
              </Half>
            </div>
            <p className="mt-5 max-w-[56ch] text-sm text-graphite">
              A real invoice is cut from its own fingerprint and fits the half Acme keeps. This one has no fingerprint to cut from.
            </p>
          </section>

          <section aria-labelledby="why">
            <h2 id="why" className="font-display text-3xl">
              Why
            </h2>
            <ol className="mt-4 border-t border-ink">
              {reasons.map((r) => (
                <li key={r.title} className="grid grid-cols-[1.5rem_1fr] gap-3 border-b border-rule py-3.5">
                  <svg viewBox="0 0 16 16" className="mt-1 h-4 w-4 text-red" aria-hidden>
                    <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-sm text-graphite">{r.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-7 flex flex-wrap gap-3">
              <Act className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper" done="Studio Ana has been warned at her verified address, with the sender and time of this email.">Warn Studio Ana</Act>
              <Act
                className="rounded-doc border border-red px-4 py-2.5 text-sm font-medium text-red hover:bg-red-wash"
                confirm={{ title: "Mark as fraud", body: "This sender is blocked for Acme, and the email is recorded as fraud in the decision log. It can’t be undone from here.", action: "Mark as fraud" }}
                done="Marked as fraud. The sender is blocked and the record is in the log."
              >
                Mark as fraud
              </Act>
              <Act className="rounded-doc border border-rule px-4 py-2.5 text-sm font-medium" done="Asked the sender to send a sealed invoice through Symbolon. Nothing is paid until one arrives.">Ask for a sealed invoice</Act>
            </div>
            <p className="mt-4 text-sm text-graphite">
              Even if someone at Acme tried to pay this, the Vault would refuse: the address isn’t one Studio Ana’s Seal signed.
            </p>
          </section>
        </div>
      </main>
  );
}
