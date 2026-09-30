"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function BusinessSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (error.digest) {
      console.error("Business segment error:", error.digest);
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-[640px] px-6 py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-red">Business Section Notice</p>
      <h2 className="mt-3 font-display text-3xl">Unable to load this section right now.</h2>
      <p className="mt-3 text-graphite text-base">
        Nothing was changed. Your Vault and records remain secure.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-graphite/70">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90 focus:outline-none focus:ring-2 focus:ring-seal"
        >
          Try again
        </button>
        <Link
          href="/business"
          className="rounded-doc border border-rule px-4 py-2 text-sm font-medium hover:bg-paper-raised focus:outline-none focus:ring-2 focus:ring-seal"
        >
          Business overview
        </Link>
      </div>
    </div>
  );
}
