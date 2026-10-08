import { Shell } from "@/components/shell/Shell";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";
import { showCodeToSeal } from "@/lib/server/verification";
import { formatDateTime } from "@/lib/format";
import { Address } from "@/components/Address";
import { EmptyState } from "@/components/ui/States";
import { Lead, PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export default async function VendorVerificationPage() {
  const session = await requirePageSession("/vendor/verify");
  const db = await getDb();
  const where = await loadSpaces(session);
  const requests = await showCodeToSeal(db, session.user);
  return (
    <Shell where={where} current={{ kind: "vendor" }}>
      <div>
        <PageTitle>First-contact checks</PageTitle>
        <Lead className="mt-3">A business may call you on a number or channel it already trusts. Read it the code below. Never share a code with someone who contacted you unexpectedly.</Lead>
        {requests.length ? (
          <ul className="mt-8 divide-y divide-rule-soft border-y border-rule">
            {requests.map((r) => (
              <li key={r.id} className="py-5">
                <p className="font-medium text-ink">{r.businessName}</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-sm text-graphite">
                  <span>Vault</span>
                  {r.vault ? <Address value={r.vault} /> : "not available"}
                </div>
                <p className="mt-4 font-display text-5xl tracking-[0.25em] text-ink" aria-label={`Verification code ${r.code}`}>{r.code}</p>
                <p className="mt-2 text-sm text-graphite">Expires {formatDateTime(r.expiresAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No checks waiting" className="mt-8">When a business wants to verify you by phone, the code to read out shows up here.</EmptyState>
        )}
      </div>
    </Shell>
  );
}
