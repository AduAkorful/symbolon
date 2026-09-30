"use client";

import Link from "next/link";
import { useEffect } from "react";

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
          <h1 className="mt-4 font-display text-4xl leading-tight">Something went wrong.</h1>
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
      </body>
    </html>
  );
}
