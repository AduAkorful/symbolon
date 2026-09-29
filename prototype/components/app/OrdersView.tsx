"use client";

import { useState } from "react";
import { Act } from "@/components/Act";
import { Overlay } from "@/components/Overlay";

type Kind = "One-off" | "Retainer" | "Milestone" | "Rate-based";
interface PO {
  id: string;
  vendor: string;
  what: string;
  kind: Kind;
  budget: string;
  total: string;
  invoiced: string;
  paid: string;
  remaining: string;
  delivery: "confirmed" | "waiting" | "rejected" | "per milestone" | "per period";
  deliveryNote: string;
  raisedBy: string;
  milestones?: { name: string; amount: string; state: string }[];
}

const initial: PO[] = [
  { id: "PO-0044", vendor: "Forge Supply", what: "4 workstations", kind: "One-off", budget: "Operations", total: "$14,000.00", invoiced: "$14,000.00", paid: "$0.00", remaining: "$14,000.00", delivery: "waiting", deliveryNote: "Invoice F-778 is held until this is confirmed", raisedBy: "Dele" },
  { id: "PO-0027", vendor: "Northwind Agency", what: "Launch campaign", kind: "One-off", budget: "Marketing", total: "$9,000.00", invoiced: "$9,000.00", paid: "$0.00", remaining: "$9,000.00", delivery: "confirmed", deliveryNote: "Launch assets delivered 26 Sep", raisedBy: "Ama" },
  { id: "PO-0031", vendor: "Studio Ana", what: "Design retainer", kind: "Retainer", budget: "Design", total: "$2,000.00 a month", invoiced: "$2,000.00 in Oct", paid: "$1,985.00 in Oct", remaining: "$0.00 in Oct", delivery: "per period", deliveryNote: "Monthly sign-off in Linear; October signed off 30 Sep", raisedBy: "Dele" },
  {
    id: "PO-0048", vendor: "Northwind Agency", what: "Website rebuild", kind: "Milestone", budget: "Marketing", total: "$12,000.00", invoiced: "$4,000.00", paid: "$4,000.00", remaining: "$8,000.00", delivery: "per milestone", deliveryNote: "Each milestone releases when it’s delivered, not before its date", raisedBy: "Ama",
    milestones: [
      { name: "Design", amount: "$4,000.00", state: "Delivered 12 Sep · paid" },
      { name: "Build", amount: "$6,000.00", state: "Not before 15 Oct" },
      { name: "Launch", amount: "$2,000.00", state: "Not before 5 Nov" },
    ],
  },
  { id: "PO-0050", vendor: "Kestrel Labs", what: "API integration work", kind: "Rate-based", budget: "Engineering", total: "Up to $5,200.00 (40 h × $130.00)", invoiced: "$2,600.00", paid: "$0.00", remaining: "$2,600.00", delivery: "confirmed", deliveryNote: "20 hours signed off in the time tracker", raisedBy: "Kofi" },
  { id: "PO-0039", vendor: "Halden Freight", what: "Freight, September", kind: "One-off", budget: "Operations", total: "$4,100.00", invoiced: "$4,100.00", paid: "$0.00", remaining: "$4,100.00", delivery: "confirmed", deliveryNote: "Delivered 24 Sep", raisedBy: "Dele" },
];

const deliveryTone: Record<PO["delivery"], string> = {
  confirmed: "text-seal",
  waiting: "text-red",
  rejected: "text-red",
  "per milestone": "text-graphite",
  "per period": "text-graphite",
};

/** Orders (B11) and delivery (B12): the payer's half of every match */
export function OrdersView() {
  const [pos, setPos] = useState(initial);
  const [open, setOpen] = useState<string | null>("PO-0044");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<Kind>("One-off");

  const setDelivery = (id: string, delivery: PO["delivery"], deliveryNote: string) =>
    setPos(pos.map((p) => (p.id === id ? { ...p, delivery, deliveryNote } : p)));

  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <div data-reveal className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl">Orders</h1>
          <p className="mt-2 max-w-[64ch] text-graphite">What Acme ordered, from whom, and up to how much. An invoice matches against its order and the delivery before it can be paid.</p>
        </div>
        <button onClick={() => setCreating(true)} className="rounded-doc bg-ink px-4 py-2.5 text-sm font-medium text-paper">
          New order
        </button>
      </div>

      <div data-reveal className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[860px] border-t border-ink text-[15px]">
          <thead>
            <tr className="text-left text-xs text-graphite">
              <th className="py-3 pr-4 font-normal">Order</th>
              <th className="py-3 pr-4 font-normal">Vendor</th>
              <th className="py-3 pr-4 font-normal">Kind</th>
              <th className="py-3 pr-4 text-right font-normal">Invoiced</th>
              <th className="py-3 pr-4 text-right font-normal">Remaining</th>
              <th className="py-3 font-normal">Delivery</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((p) => (
              <FragmentRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)}>
                <div className="grid gap-6 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <dl className="space-y-1.5 text-sm">
                    {[
                      ["What", p.what],
                      ["Total", p.total],
                      ["Paid", p.paid],
                      ["Budget", p.budget],
                      ["Raised by", p.raisedBy],
                    ].map(([k, v]) => (
                      <div key={k} className="flex gap-3">
                        <dt className="w-24 shrink-0 text-graphite">{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div>
                    {p.milestones ? (
                      <ol className="border-t border-rule text-sm">
                        {p.milestones.map((m) => (
                          <li key={m.name} className="flex justify-between gap-3 border-b border-rule py-2">
                            <span>
                              {m.name} · {m.amount}
                            </span>
                            <span className="text-graphite">{m.state}</span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    <p className={`text-sm ${deliveryTone[p.delivery]}`}>{p.deliveryNote}</p>
                    {p.delivery === "waiting" ? (
                      rejecting ? (
                        <form
                          className="mt-3 space-y-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!reason.trim()) return;
                            setDelivery(p.id, "rejected", `Rejected: ${reason}. Forge Supply has been told; F-778 stays held.`);
                            setRejecting(false);
                          }}
                        >
                          <label htmlFor="rej" className="block text-sm">
                            What’s wrong? Forge Supply sees this.
                          </label>
                          <input id="rej" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Two of the four workstations arrived damaged" className="w-full rounded-doc border border-rule bg-paper px-3 py-2 text-sm" />
                          <div className="flex gap-2">
                            <button className="rounded-doc bg-ink px-3 py-2 text-sm text-paper disabled:opacity-40" disabled={!reason.trim()}>
                              Reject delivery
                            </button>
                            <button type="button" onClick={() => setRejecting(false)} className="rounded-doc border border-rule px-3 py-2 text-sm">
                              Back
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button onClick={() => setDelivery(p.id, "confirmed", "Confirmed just now by you. F-778 now waits for the owner’s signature.")} className="rounded-doc bg-ink px-3 py-2 text-sm font-medium text-paper">
                            Confirm delivery
                          </button>
                          <button onClick={() => setRejecting(true)} className="rounded-doc border border-red/60 px-3 py-2 text-sm text-red hover:bg-red-wash">
                            Reject delivery
                          </button>
                        </div>
                      )
                    ) : null}
                    <div className="mt-4 flex gap-2">
                      <Act
                        className="rounded-doc border border-rule px-3 py-1.5 text-xs hover:border-ink"
                        confirm={{ title: `Close ${p.id}?`, body: "Nothing more can be invoiced against it. What’s been paid stays paid.", action: "Close the order" }}
                        done={`${p.id} is closed. New invoices against it are held.`}
                      >
                        Close order
                      </Act>
                    </div>
                  </div>
                </div>
              </FragmentRow>
            ))}
          </tbody>
        </table>
      </div>

      <section data-reveal aria-labelledby="tools" className="mt-14">
        <h2 id="tools" className="font-display text-3xl">
          Delivery from your tools
        </h2>
        <p className="mt-2 max-w-[64ch] text-sm text-graphite">Let deliveries confirm themselves when the work is done where it happens. A person can still reject afterwards.</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Linear", "An issue moves to Done", true],
            ["GitHub", "A pull request merges or a release ships", false],
            ["Jira", "An issue moves to Done", false],
            ["Time tracker", "The client signs off a timesheet", true],
          ].map(([n, d, on]) => (
            <li key={n as string} className="rounded-doc border border-rule p-4">
              <p className="font-medium">{n}</p>
              <p className="mt-1 text-sm text-graphite">{d}</p>
              <p className={`mt-3 text-sm ${on ? "text-seal" : ""}`}>{on ? "✓ Connected" : <Act className="underline decoration-rule underline-offset-4" done={`✓ Connected to ${n}`}>Connect</Act>}</p>
            </li>
          ))}
        </ul>
      </section>

      {creating ? (
        <Overlay aria-labelledby="new-po">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCreating(false);
            }}
            className="w-full max-w-lg space-y-4 rounded-t-2xl border border-rule bg-paper-raised p-7 shadow-2xl md:rounded-2xl"
          >
            <h2 id="new-po" className="font-display text-3xl">
              New order
            </h2>
            <label className="block text-sm">
              Kind
              <span className="mt-1 grid grid-cols-4 overflow-hidden rounded-doc border border-rule">
                {(["One-off", "Retainer", "Milestone", "Rate-based"] as Kind[]).map((k) => (
                  <button type="button" key={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={`py-2 text-xs ${kind === k ? "bg-ink text-paper" : ""}`}>
                    {k}
                  </button>
                ))}
              </span>
            </label>
            <label className="block text-sm">
              Vendor
              <select className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2">
                {["Studio Ana", "Northwind Agency", "Forge Supply", "Halden Freight", "Kestrel Labs", "Cloudline"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {kind === "Retainer" ? "Cap each month" : kind === "Rate-based" ? "Hours × rate, up to" : kind === "Milestone" ? "Milestones (name, amount, not before)" : "Amount"}
              <input className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2" placeholder={kind === "Milestone" ? "Design, 4000, 1 Oct; Build, 6000, 15 Oct" : kind === "Rate-based" ? "40 × 130.00" : "2,400.00"} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked /> Require a confirmed delivery before paying
            </label>
            <p className="text-xs text-graphite">The vendor quotes this order’s number on their invoice; the Steward matches it.</p>
            <div className="flex gap-3">
              <button className="flex-1 rounded-doc bg-ink py-2.5 font-medium text-paper">Open the order</button>
              <button type="button" onClick={() => setCreating(false)} className="rounded-doc border border-rule px-4 py-2.5">
                Cancel
              </button>
            </div>
          </form>
        </Overlay>
      ) : null}
    </main>
  );
}

function FragmentRow({ p, open, onToggle, children }: { p: PO; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-rule">
        <td className="pr-4">
          <button onClick={onToggle} aria-expanded={open} className="py-4 font-mono text-sm hover:text-seal">
            {open ? "▾" : "▸"} {p.id}
          </button>
        </td>
        <td className="pr-4">
          {p.vendor}
          <span className="block text-xs text-graphite">{p.what}</span>
        </td>
        <td className="pr-4 text-sm">{p.kind}</td>
        <td className="pr-4 text-right tabular-nums">{p.invoiced}</td>
        <td className="pr-4 text-right tabular-nums">{p.remaining}</td>
        <td className={`text-sm capitalize ${deliveryTone[p.delivery]}`}>{p.delivery}</td>
      </tr>
      {open ? (
        <tr className="bg-paper-raised/60">
          <td colSpan={6} className="px-4">
            {children}
          </td>
        </tr>
      ) : null}
    </>
  );
}
