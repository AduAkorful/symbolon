"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/Type";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (error.digest) {
      console.error("Global error digest:", error.digest);
    }
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-paper text-ink font-sans antialiased min-h-screen flex flex-col justify-center items-center px-6 py-20 text-center">
        <main className="max-w-[560px]">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-red">Critical Failure</p>
          <PageTitle className="mt-4">Something went wrong.</PageTitle>
          <p className="mt-4 text-graphite text-lg">
            Nothing was changed. No onchain transactions or records were affected.
          </p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-graphite/70">
              Reference: {error.digest}
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
      </body>
    </html>
  );
}
