import { Act } from "@/components/Act";
const rows = [
  { who: "Studio Ana", addr: "0x7a3f…c219", risk: "Low", last: "21 Sep", next: "21 Oct" },
  { who: "Northwind Agency", addr: "0x2f9a…b813", risk: "Low", last: "21 Sep", next: "21 Oct" },
  { who: "Northwind Agency (new address)", addr: "0x6c2d…90af", risk: "Low", last: "Today", next: "Before it’s used" },
  { who: "Forge Supply", addr: "0x45d0…9e3a", risk: "Low", last: "15 Sep", next: "15 Oct" },
  { who: "Kestrel Labs", addr: "0x8e41…c07d", risk: "Medium", last: "25 Sep", next: "2 Oct (weekly)" },
  { who: "Halden Retail (sender)", addr: "0x0b7f…22c9", risk: "Low", last: "Today", next: "28 Oct" },
];

const tiers = [
  ["Low", "Pays normally"],
  ["Medium", "Lower auto-pay limit; an approver signs"],
  ["High", "Blocked until the owner reviews"],
  ["Sanctioned", "Blocked"],
];

/** Compliance (B21): every counterparty screened on a schedule tied to risk; tiers, not yes/no */
export function ComplianceView() {
  return (
    <main className="px-6 pb-24 pt-10 md:px-10">
      <h1 data-reveal className="font-display text-5xl">
        Compliance
      </h1>
      <p data-reveal className="mt-2 max-w-[64ch] text-graphite">
        Every payout address and funding source is screened when it first appears, and again on a schedule: weekly for medium risk and above,
        monthly otherwise. A failed check is never treated as clean.
      </p>
      <div className="mt-10 grid gap-12 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section data-reveal aria-labelledby="screened">
          <h2 id="screened" className="font-display text-3xl">
            Counterparties
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-t border-ink text-sm">
              <thead>
                <tr className="text-left text-xs text-graphite">
                  {["Who", "Address", "Risk", "Checked", "Next"].map((h) => (
                    <th key={h} className="py-3 pr-4 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.addr} className="border-t border-rule">
                    <td className="py-3 pr-4">{r.who}</td>
                    <td className="pr-4 font-mono text-xs">{r.addr}</td>
                    <td className={`pr-4 ${r.risk === "Low" ? "" : "text-red"}`}>{r.risk}</td>
                    <td className="pr-4 text-graphite">{r.last}</td>
                    <td className="text-graphite">{r.next}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="space-y-10">
          <section data-reveal aria-labelledby="tiers">
            <h2 id="tiers" className="font-display text-2xl">
              What each tier does
            </h2>
            <dl className="mt-3 border-t border-ink text-sm">
              {tiers.map(([t, d]) => (
                <div key={t} className="grid grid-cols-[7rem_1fr] border-b border-rule py-2.5">
                  <dt className={t === "Low" ? "" : "text-red"}>{t}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section data-reveal aria-labelledby="alerts">
            <h2 id="alerts" className="font-display text-2xl">
              Alerts
            </h2>
            <p className="mt-3 rounded-doc border border-red/40 p-4 text-sm">
              <span className="text-red">Kestrel Labs moved to medium risk on 25 Sep</span>: its address received funds from a service flagged last month.
              Its invoices now need an approver, and it’s rechecked weekly.
            </p>
          </section>
          <section data-reveal aria-labelledby="report">
            <h2 id="report" className="font-display text-2xl">
              Reports
            </h2>
            <p className="mt-2 text-sm text-graphite">September: 14 counterparties screened, 1 alert, 1 resolved. Each links to its decision records.</p>
            <div className="mt-3">
              <Act
                className="rounded-doc border border-rule px-3 py-2 text-sm hover:border-ink"
                download={{
                  filename: "acme-screening-september.csv",
                  mime: "text/csv",
                  text: ["Counterparty,Address,Risk,Last screened,Next", ...rows.map((r) => [r.who, r.addr, r.risk, r.last, r.next].map((c) => `"${c}"`).join(","))].join("\n"),
                }}
                done="Downloaded acme-screening-september.csv"
              >
                Download September report
              </Act>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
