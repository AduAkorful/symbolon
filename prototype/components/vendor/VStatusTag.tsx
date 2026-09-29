import { vStatusLabel, type VStatus } from "@/lib/ana";

const tone: Record<VStatus, string> = {
  draft: "text-graphite",
  sent: "text-graphite",
  viewed: "text-ink",
  scheduled: "text-ink",
  paid: "text-seal",
  cancelled: "text-red",
};

export function VStatusTag({ status }: { status: VStatus }) {
  return <span className={`font-mono text-[11px] uppercase tracking-[0.14em] ${tone[status]}`}>{vStatusLabel[status]}</span>;
}
