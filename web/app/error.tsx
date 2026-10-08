"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { buttonClass } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/Type";

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
        <PageTitle className="mt-4">
          Something went wrong on our side.
        </PageTitle>
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
            className={buttonClass()}
          >
            Try again
          </button>
          <Link
            href="/"
            className={buttonClass({ variant: "secondary" })}
          >
            Go home
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
