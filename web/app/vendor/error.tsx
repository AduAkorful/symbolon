"use client";

import { useEffect } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { SectionTitle } from "@/components/ui/Type";

export default function VendorSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (error.digest) {
      console.error("Vendor segment error:", error.digest);
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-[640px] px-6 py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-red">Vendor Section Notice</p>
      <SectionTitle className="mt-3">Unable to load this section right now.</SectionTitle>
      <p className="mt-3 text-graphite text-base">
        Nothing was changed. Your Seal and sealed invoices are unaffected.
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
          className={buttonClass()}
        >
          Try again
        </button>
        <Link
          href="/vendor"
          className={buttonClass({ variant: "secondary" })}
        >
          Vendor overview
        </Link>
      </div>
    </div>
  );
}
