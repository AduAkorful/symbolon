import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { showCodeToSeal } from "@/lib/server/verification";

export const dynamic = "force-dynamic";

export default async function VendorVerificationPage() {
  const session = await requirePageSession("/v/verify");
  const db = await getDb();
  const where = await loadSpaces(session);
  const requests = await showCodeToSeal(db, session.user);
  return <Shell where={where} current={{ kind: "vendor" }}>
    <div className="max-w-[760px]">
      <h1 className="font-display text-4xl">First-contact checks</h1>
      <p className="mt-3 max-w-[62ch] text-graphite">A business may call you at a number or channel it already trusts. Read the code below to that person. Do not share it with anyone who contacted you unexpectedly.</p>
      {requests.length ? <ul className="mt-8 divide-y divide-rule border-y border-rule">{requests.map((r) => <li key={r.id} className="py-5">
        <p className="font-medium">{r.businessName}</p>
        <p className="mt-1 break-all font-mono text-xs text-graphite">Vault: {r.vault ?? "not available"}</p>
        <p className="mt-4 font-mono text-3xl tracking-[0.3em]" aria-label={`Verification code ${r.code}`}>{r.code}</p>
        <p className="mt-2 text-xs text-graphite">Expires {r.expiresAt?.toLocaleString()}</p>
      </li>)}</ul> : <p className="mt-8 border-y border-rule py-6 text-graphite">No active verification requests.</p>}
    </div>
  </Shell>;
}
