"use client";

import Link from "next/link";

import { Callout } from "@/components/ui/Callout";
import type { ReleaseNudgeResult } from "@/lib/server/release";

interface ReleaseNudgeProps {
  nudge: ReleaseNudgeResult | null;
}

export function ReleaseNudge({ nudge }: ReleaseNudgeProps) {
  if (!nudge || !nudge.hasNudge) return null;

  return (
    <Callout tone="info" title="An upgrade is available">
      <p>
        Release {nudge.latestVersion} is available for your Vault.{" "}
        <Link href="/business/settings#upgrades" className="underline decoration-seal/40 underline-offset-4 hover:text-ink">See the notes and schedule it →</Link>
      </p>
    </Callout>
  );
}
