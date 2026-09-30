"use client";

import Link from "next/link";
import type { ReleaseNudgeResult } from "@/lib/server/release";

interface ReleaseNudgeProps {
  nudge: ReleaseNudgeResult | null;
}

export function ReleaseNudge({ nudge }: ReleaseNudgeProps) {
  if (!nudge || !nudge.hasNudge) return null;

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-baseline justify-between gap-3 rounded-doc border border-seal/30 bg-seal-wash/40 px-4 py-2.5 text-xs text-graphite"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider font-semibold text-seal">
          Upgrade
        </span>
        <span className="text-ink">
          Release {nudge.latestVersion} is available for your Vault.
        </span>
      </div>
      <Link
        href="/business/settings#upgrades"
        className="font-medium text-seal underline hover:text-ink"
      >
        See notes & schedule →
      </Link>
    </div>
  );
}
