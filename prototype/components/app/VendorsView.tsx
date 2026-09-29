"use client";

import { useEffect, useRef, useState } from "react";
import { Act } from "@/components/Act";
import { TxLink } from "@/components/TxLink";
import { tx } from "@/lib/tx";
import { Overlay } from "@/components/Overlay";
import type { VendorTrust } from "@/lib/acme";
import { TrustTag } from "./tags";
import { VerifyVendor } from "./VerifyVendor";
import { Avatar } from "@/components/Avatar";
import { useProfile } from "@/components/profile";

const vendors: Vendor[] = [
  { id: "kestrel", name: "Kestrel Labs", handle: "@kestrel-labs", trust: "new", payout: "0x8e41…c07d · Arc · USDC", budget: "Engineering", cap: "—", match: "Invoice only", risk: "Low · 25 Sep", paid: "None yet" },
  { id: "northwind", name: "Northwind Agency", handle: "@northwind", trust: "verified", payout: "0x2f9a…b813 · Arc · USDC", budget: "Marketing", cap: "$12,000.00 / month", match: "Invoice + PO + delivery", risk: "Low · 21 Sep", paid: "6 invoices" },
  { id: "ana", name: "Studio Ana", handle: "@studio-ana", trust: "verified", payout: "0x7a3f…c219 · Arc · USDC", budget: "Design", cap: "$5,000.00 / month", match: "Invoice + PO + delivery for the retainer", risk: "Low · 21 Sep", paid: "8 invoices" },
  { id: "forge", name: "Forge Supply", handle: "@forge-supply", trust: "verified", payout: "0x45d0…9e3a · Arc · USDC", budget: "Operations", cap: "$20,000.00 / month", match: "Invoice + PO + delivery", risk: "Low · 15 Sep", paid: "2 invoices" },
  { id: "halden", name: "Halden Freight", handle: "@halden", trust: "verified", payout: "0x93bc…1a26 · Base · USDC", budget: "Operations", cap: "$8,000.00 / month", match: "Invoice + PO + delivery", risk: "Low · 22 Sep", paid: "5 invoices" },
  { id: "cloudline", name: "Cloudline", handle: "@cloudline", trust: "verified", payout: "0xd271…5f0b · Arc · USDC", budget: "Engineering", cap: "$2,000.00 / month", match: "Invoice only", risk: "Low · 20 Sep", paid: "9 invoices" },
  { id: "nordlicht", name: "Nordlicht Studio", handle: "@nordlicht", trust: "verified", payout: "0x3e77…a0d2 · Arc · EURC", budget: "Design", cap: "€6,000.00 / month", match: "Invoice + PO", risk: "Low · 22 Sep", paid: "None yet" },
  { id: "brightwell", name: "Brightwell Print", handle: "Not sealed yet", trust: "invited", payout: "They add it when they accept", budget: "Marketing", cap: "$3,000.00 / month", match: "Invoice + PO", risk: "Not screened yet", paid: "None yet", email: "accounts@brightwell.example" },
];

interface Vendor {
  id: string;
  name: string;
  handle: string;
  trust: VendorTrust;
  payout: string;
  budget: string;
  cap: string;
  match: string;
  risk: string;
  paid: string;
  /** The contact the invitation went to */
  email?: string;
}

/** How each vendor was verified, and by whom (spec §11.1): the method, the evidence and who confirmed it */
const verifiedHow: Record<string, string> = {
  northwind: "A code, confirmed by you, 12 Aug",
  ana: "A code, confirmed by you, 30 Aug",
  forge: "A records match (2), confirmed by Dele and then you, because the cap is over $10,000.00 · 4 Sep",
  halden: "A code, confirmed by you, 1 Sep",
  cloudline: "A records match (2), confirmed by you, 20 Aug",
  nordlicht: "Invitation accepted by hello@nordlicht.example, 22 Sep",
};


// Northwind's payout change was signed at 11:02 on 28 Sep; the cooldown is 72 hours
const COOLDOWN_END = Date.now() + (70 * 3600 + 58 * 60 + 12) * 1000;

function useCountdown(end: number) {
  // Starts after mount so the server and the browser render the same first frame
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return { text: "70 h 58 m", fraction: 0.014 };
  const s = Math.max(0, Math.floor((end - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return { text: `${h} h ${String(m).padStart(2, "0")} m ${String(s % 60).padStart(2, "0")} s`, fraction: 1 - s / (72 * 3600) };
}

/** Vendors (B8), verification (B9), adding a vendor by invitation, and pending changes (B10) */
export function VendorsView() {
  const [list, setList] = useState<Vendor[]>(vendors);
  const [selected, setSelected] = useState("kestrel");
  const [kestrelTrust, setKestrelTrust] = useState<"new" | "address" | "verified">("new");
  const [adding, setAdding] = useState(false);
  const [change, setChange] = useState<"pending" | "confirmed" | "cancelled">("pending");
  const countdown = useCountdown(COOLDOWN_END);
  const v = list.find((x) => x.id === selected)!;
  const { logoOf } = useProfile();
  const detailRef = useRef<HTMLElement>(null);
  const [pulse, setPulse] = useState(false);
  const showDetail = () => {
    setSelected("kestrel");
    // The panel is already on screen when Kestrel is selected, so a click has to bring it to the eye
    setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      setPulse(true);
      setTimeout(() => setPulse(false), 1600);
    }, 0);
  };
  const kestrelVerified = kestrelTrust === "verified";

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Vendors
      </h1>
      <p data-reveal className="mt-2 max-w-[70ch] text-graphite">
        Who Acme pays, and where. Adding a vendor, or changing where one is paid, always goes through a person, a signature and a wait.
      </p>

      <section data-reveal aria-labelledby="waiting" className="mt-10">
        <h2 id="waiting" className="font-display text-3xl">
          Waiting on you
        </h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className={`rounded-doc border p-5 ${change === "pending" ? "border-red/50" : "border-rule"}`}>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-red">Payout address change</p>
            <p className="mt-2 text-lg font-medium">Northwind Agency wants to be paid at a new address</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-graphite">From</dt>
                <dd className="font-mono">0x2f9a…b813</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-graphite">To</dt>
                <dd className="font-mono">0x6c2d…90af, on Arc</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-graphite">Signed</dt>
                <dd>By Northwind’s Seal, 28 Sep 11:02, in their Symbolon account</dd>
              </div>
            </dl>
            {change === "pending" ? (
              <>
                <p className="mt-4 text-sm">
                  Payable from the new address in <span className="font-mono tabular-nums">{countdown.text}</span>, and only after you confirm.
                </p>
                <div className="mt-2 h-1.5 w-full bg-rule-soft" aria-hidden>
                  <div className="h-full bg-red/70" style={{ width: `${Math.min(100, countdown.fraction * 100)}%` }} />
                </div>
                <p className="mt-3 text-xs text-graphite">Invoices Northwind already sealed stay payable to the old address. Worth a quick call to Northwind on a number you already have.</p>
                <div className="mt-4 flex gap-3">
                  <button onClick={() => setChange("confirmed")} className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
                    Confirm the change
                  </button>
                  <button onClick={() => setChange("cancelled")} className="rounded-doc border border-red/60 px-4 py-2 text-sm text-red hover:bg-red-wash">
                    Cancel it
                  </button>
                </div>
              </>
            ) : (
              <p role="status" className="mt-4 text-sm">
                {change === "confirmed" ? (
                  <>
                    Confirmed. The new address takes effect when the cooldown ends ({countdown.text}). <TxLink hash={tx.payoutConfirm}>Confirmed in {tx.payoutConfirm}</TxLink>
                  </>
                ) : (
                  <>
                    Cancelled. Northwind is paid at its current address; they’ve been told. <TxLink hash={tx.payoutCancel}>Cancelled in {tx.payoutCancel}</TxLink>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="rounded-doc border border-rule p-5">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-graphite">New vendor</p>
            <p className="mt-2 text-lg font-medium">
              {kestrelVerified
                ? "Kestrel Labs is verified. Add them as a payee to pay KL-301"
                : kestrelTrust === "address"
                  ? "Kestrel Labs’ address is confirmed, but Acme hasn’t confirmed who they are"
                  : "Kestrel Labs sealed an invoice, and Acme hasn’t verified them yet"}
            </p>
            <p className="mt-1 text-sm text-graphite">Invoice KL-301 · $2,600.00 · due 22 Oct</p>
            <button onClick={showDetail} className="mt-4 rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper">
              {kestrelVerified ? "See Kestrel Labs" : "Verify Kestrel Labs"}
            </button>
          </div>
        </div>
      </section>

      <div className="mt-12 grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section data-reveal aria-labelledby="all">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="all" className="font-display text-3xl">
              All vendors
            </h2>
            <button onClick={() => setAdding(true)} className="rounded-doc border border-rule px-3 py-1.5 text-sm hover:border-ink">
              Add a vendor
            </button>
          </div>
          <ul className="mt-5 border-t border-ink">
            {list.map((x) => (
              <li key={x.id} className="border-b border-rule">
                <button onClick={() => setSelected(x.id)} aria-pressed={selected === x.id} className={`grid w-full grid-cols-[1fr_auto] items-center gap-4 px-2 py-3.5 text-left ${selected === x.id ? "bg-paper-raised" : "hover:bg-rule-soft/40"}`}>
                  <span className="flex items-center gap-3">
                    <Avatar name={x.name} src={logoOf(x.name)} show={(x.id === "kestrel" ? kestrelTrust : x.trust) === "verified"} size={32} />
                    <span>
                      <span className="font-medium">{x.name}</span>
                      <span className="block text-xs text-graphite">{x.budget}</span>
                    </span>
                  </span>
                  <TrustTag trust={x.id === "kestrel" ? kestrelTrust : x.trust} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section ref={detailRef} data-reveal aria-labelledby="detail" className={`scroll-mt-6 rounded-doc border bg-paper-raised p-6 transition-shadow duration-[var(--dur-arrive)] ${pulse ? "border-seal shadow-[0_0_0_3px_var(--seal-wash)]" : "border-rule"}`}>
          <div className="flex items-center gap-4">
            <Avatar name={v.name} src={logoOf(v.name)} show={(v.id === "kestrel" ? kestrelTrust : v.trust) === "verified"} size={48} />
            <div>
              <h2 id="detail" className="font-display text-3xl">
                {v.name}
              </h2>
              <p className="font-mono text-sm text-graphite">{v.handle}</p>
            </div>
          </div>
          <dl className="mt-5 text-sm">
            {[
              ["Paid at", v.payout],
              ["Budget", v.budget],
              ["Monthly cap", v.cap],
              ["Needs", v.match],
              ["Screening", v.risk],
              ...(v.trust === "verified" && verifiedHow[v.id] ? [["Verified", verifiedHow[v.id]!]] : []),
              ["History", v.paid],
            ].map(([k, val]) => (
              <div key={k} className="grid grid-cols-[7rem_1fr] gap-3 border-b border-rule-soft py-2">
                <dt className="text-graphite">{k}</dt>
                <dd className={k === "Paid at" ? "font-mono" : ""}>{val}</dd>
              </div>
            ))}
          </dl>

          {v.id === "kestrel" ? (
            <div className="mt-6 border-t border-ink pt-5">
              <VerifyVendor onTrust={setKestrelTrust} />
            </div>
          ) : v.trust === "invited" ? (
            <div className="mt-6 border-t border-ink pt-5">
              <p className="font-medium">Waiting for {v.name} to accept</p>
              <p className="mt-2 text-sm">
                Invitation sent to {v.email}, expires in 6 days. When they accept, their Seal is linked to this record and Verified for Acme. No code is needed, because the invitation went
                to a contact you chose.
              </p>
              <p className="mt-2 text-xs text-graphite">Their first invoice still goes to an approver, and Acme’s 24-hour wait for new payees applies.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Act className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink" done={`Invitation sent again to ${v.email}.`}>
                  Send it again
                </Act>
                <Act
                  className="rounded-doc border border-red/60 px-4 py-2 text-sm text-red hover:bg-red-wash"
                  confirm={{ title: `Cancel the invitation to ${v.name}`, body: "The link stops working. You can invite them again.", action: "Cancel the invitation" }}
                  done="Invitation cancelled. The link no longer works."
                >
                  Cancel the invitation
                </Act>
              </div>
            </div>
) : (
            <div className="mt-6 flex flex-wrap gap-3">
              <Act
                className="rounded-doc border border-rule px-4 py-2 text-sm hover:border-ink"
                confirm={{ title: `Edit ${v.name}’s terms`, body: `Their monthly cap is ${v.cap}. Making it stricter applies at once; making it looser waits 24 hours.`, action: "Sign", field: { label: "New monthly cap ($)", placeholder: "10,000", inputMode: "decimal" } }}
                done={(val) => {
                  const now = Number(val.replace(/[^\d.]/g, ""));
                  const was = Number(v.cap.replace(/[^\d.]/g, "").split(".")[0] || 0);
                  const loosens = now > was;
                  return (
                    <>
                      {v.name}’s cap is {loosens ? "going up" : "now"} ${now.toLocaleString("en-US", { minimumFractionDigits: 2 })} a month{loosens ? "; it takes effect in 24 h 00 m." : "."}{" "}
                      <TxLink hash={loosens ? tx.policyQueue : tx.policyApply}>{loosens ? tx.policyQueue : tx.policyApply}</TxLink>
                    </>
                  );
                }}
              >
                Edit terms
              </Act>
              <Act
                className="rounded-doc border border-red/60 px-4 py-2 text-sm text-red hover:bg-red-wash"
                tx={tx.payeeRetire}
                confirm={{ title: `Stop paying ${v.name}`, body: "Their scheduled invoices are held and nothing more is paid. It’s recorded in the Vault, and you can add them again later.", action: "Sign and stop" }}
                done={`${v.name} is stopped. Nothing scheduled will be paid.`}
              >
                Stop paying this vendor
              </Act>
            </div>
          )}
        </section>
      </div>
      {adding ? (
        <Overlay aria-labelledby="add-title">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const name = String(f.get("name")).trim();
              const id = name.toLowerCase().replace(/\W+/g, "-");
              setList((l) => [...l, { id, name, handle: "Not sealed yet", trust: "invited", payout: "They add it when they accept", budget: String(f.get("budget")), cap: "Set after they accept", match: "Invoice + PO", risk: "Not screened yet", paid: "None yet", email: String(f.get("email")).trim() }]);
              setSelected(id);
              setAdding(false);
            }}
            className="w-full max-w-md space-y-4 rounded-t-2xl border border-rule bg-paper-raised p-7 text-ink shadow-2xl md:rounded-2xl"
          >
            <h2 id="add-title" className="font-display text-3xl">
              Add a vendor
            </h2>
            <p className="text-sm text-graphite">
              Invite them from a contact you already have. When they accept, their Seal is linked to this record and verified for Acme, with no separate check. It’s the safest way to add a vendor.
            </p>
            <label className="block text-sm">
              Vendor name
              <input name="name" required placeholder="Brightwell Print" className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2" />
            </label>
            <label className="block text-sm">
              Their contact (one you already have)
              <input name="email" type="email" required placeholder="accounts@brightwell.example" className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2" />
            </label>
            <label className="block text-sm">
              Budget
              <select name="budget" className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2">
                {["Marketing", "Engineering", "Design", "Operations"].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-3">
              <button className="flex-1 rounded-doc bg-ink py-2.5 font-medium text-paper">Send the invitation</button>
              <button type="button" onClick={() => setAdding(false)} className="rounded-doc border border-rule px-4 py-2.5">
                Cancel
              </button>
            </div>
          </form>
        </Overlay>
      ) : null}
    </main>
  );
}
