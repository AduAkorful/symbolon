"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error digest internally without rendering internal stack to the client
    if (error.digest) {
      console.error("Application error digest:", error.digest);
    }
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col justify-between">
      <PublicHeader />
      <main id="main-content" className="mx-auto max-w-[640px] px-6 py-20 text-center md:px-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-red">System Notice</p>
        <h1 className="mt-4 font-display text-4xl leading-tight md:text-5xl">
          Something went wrong on our side.
        </h1>
        <p className="mt-4 text-graphite text-lg">
          Nothing was changed. No funds moved and no records were updated.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-graphite/70">
            Reference code: {error.digest}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button
            type="button"
            onClick={reset}
            className="rounded-doc bg-ink px-5 py-2.5 font-medium text-paper hover:bg-ink/90 focus:outline-none focus:ring-2 focus:ring-seal"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-doc border border-rule px-5 py-2.5 font-medium hover:bg-paper-raised focus:outline-none focus:ring-2 focus:ring-seal"
          >
            Go home
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
