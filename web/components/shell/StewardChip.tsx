import Link from "next/link";

import type { stewardStanding } from "@/lib/server/vault-read";

const MODE_NAMES: Record<string, string> = { shadow: "Shadow", assist: "Assisted", auto: "Auto" };

/** What the header says about the Steward: its mode, and whether the Vault shows it paused, active, or something to look at */
export function StewardChip({ standing, mode }: { standing: ReturnType<typeof stewardStanding> | null; mode: string | null | undefined }) {
  const modeName = mode ? MODE_NAMES[mode] : undefined;
  if (standing?.kind === "paused") {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap font-medium text-red">
        <span className="h-2 w-2 rounded-full bg-red" aria-hidden />
        Steward: Paused
      </span>
    );
  }
  if (standing?.kind === "mismatch") {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-warn">
        <span className="h-2 w-2 rounded-full bg-warn" aria-hidden />
        Steward mismatch
        <Link href="/business/steward" className="hidden text-sm underline underline-offset-4 sm:inline">Review</Link>
      </span>
    );
  }
  if (standing?.kind === "unknown") {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-graphite">
        <span className="h-2 w-2 rounded-full bg-warn" aria-hidden />
        Steward: can't confirm
      </span>
    );
  }
  if (standing?.kind === "active") {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-graphite">
        <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />
        Steward: <span className="text-ink">{modeName ?? "Active"}</span>
      </span>
    );
  }
  return <span className="text-graphite">Steward: Not ready</span>;
}
