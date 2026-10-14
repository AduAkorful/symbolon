"use client";

import Link from "next/link";

import { Callout } from "@/components/ui/Callout";
import { formatDateTime } from "@/lib/format";
import type { ReleaseNudgeResult } from "@/lib/server/release";

interface ReleaseNudgeProps {
  nudge: ReleaseNudgeResult | null;
  /** Where the Vault's own upgrade stands: once it is scheduled the banner says so instead of offering to schedule it (QA REL4-5) */
  state?: "up-to-date" | "available" | "scheduled" | "ready" | "revoked";
  readyAt?: number;
}

export function ReleaseNudge({ nudge, state, readyAt }: ReleaseNudgeProps) {
  if (!nudge || !nudge.hasNudge) return null;
  if (state === "scheduled" || state === "ready") {
    const waiting = state === "scheduled" && readyAt !== undefined && readyAt * 1000 > Date.now();
    return (
      <Callout tone="info" title={waiting ? "An upgrade is scheduled" : "An upgrade is ready to apply"}>
        <p>
          Release {nudge.latestVersion} is {waiting ? `scheduled and can be applied from ${formatDateTime(new Date((readyAt as number) * 1000))}` : "ready to apply"}.{" "}
          <Link href="/business/settings#upgrades" className="underline decoration-seal/40 underline-offset-4 hover:text-ink">{waiting ? "See it →" : "Apply it →"}</Link>
        </p>
      </Callout>
    );
  }

  return (
    <Callout tone="info" title="An upgrade is available">
      <p>
        Release {nudge.latestVersion} is available for your Vault.{" "}
        <Link href="/business/settings#upgrades" className="underline decoration-seal/40 underline-offset-4 hover:text-ink">See the notes and schedule it →</Link>
      </p>
    </Callout>
  );
}
