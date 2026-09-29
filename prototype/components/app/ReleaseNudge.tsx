"use client";

import Link from "next/link";
import { useRelease } from "./release";

/** A quiet line on Home while a Vault release is waiting for the owner; gone once it's applied */
export function ReleaseNudge() {
  const { state, remaining } = useRelease();
  if (state === "applied") return null;
  const text =
    state === "available"
      ? "Release 3 is available for your Vault."
      : state === "scheduled"
        ? `Release 3 is scheduled. You can apply it in ${remaining}.`
        : "Release 3 is ready to apply.";
  return (
    <p data-reveal className="mb-8 flex flex-wrap items-baseline gap-x-3 border-b border-rule pb-3 text-sm">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-seal">Vault</span>
      <span>{text}</span>
      <Link href="/b/settings#upgrades" className="underline decoration-rule underline-offset-4 hover:decoration-ink">
        {state === "ready" ? "Apply it" : "See the notes"}
      </Link>
    </p>
  );
}
