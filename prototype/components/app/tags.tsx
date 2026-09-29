import type { Status, VendorTrust } from "@/lib/acme";
import { statusLabel, trustLabel } from "@/lib/acme";

const statusTone: Record<Status, string> = {
  paid: "text-seal",
  scheduled: "text-ink",
  awaiting_approval: "text-seal",
  held: "text-red",
  refused: "text-red",
};

export function StatusTag({ status, paused = false }: { status: Status; paused?: boolean }) {
  if (paused && (status === "scheduled" || status === "awaiting_approval"))
    return <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-red">Paused</span>;
  return <span className={`font-mono text-[11px] uppercase tracking-[0.14em] ${statusTone[status]}`}>{statusLabel[status]}</span>;
}

/** Trust is identity (who sealed it), shown with a mark as well as colour */
export function TrustTag({ trust }: { trust: VendorTrust }) {
  const tone = trust === "verified" ? "text-seal" : trust === "address" ? "text-seal/75" : trust === "new" || trust === "invited" ? "text-graphite" : "text-red";
  const mark =
    trust === "verified" ? (
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    ) : trust === "address" ? (
      // a ring with a dot: the address answers, but nobody has said who they are
      <>
        <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="6" cy="6" r="1.6" fill="currentColor" />
      </>
    ) : trust === "invited" ? (
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="0.1 3.2" strokeLinecap="round" />
    ) : trust === "new" ? (
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
    ) : (
      <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" />
    );
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${tone}`}>
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
        {mark}
      </svg>
      {trustLabel[trust]}
    </span>
  );
}
